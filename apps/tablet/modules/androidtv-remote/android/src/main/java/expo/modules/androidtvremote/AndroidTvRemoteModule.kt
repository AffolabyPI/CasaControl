package expo.modules.androidtvremote

import android.content.Context
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.EOFException
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.math.BigInteger
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.security.interfaces.RSAPublicKey
import java.util.Date
import java.util.concurrent.Executors
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.X509TrustManager
import org.bouncycastle.asn1.x500.X500Name
import org.bouncycastle.cert.jcajce.JcaX509CertificateConverter
import org.bouncycastle.cert.jcajce.JcaX509v3CertificateBuilder
import org.bouncycastle.jce.provider.BouncyCastleProvider
import org.bouncycastle.operator.jcajce.JcaContentSignerBuilder

private const val TAG = "AndroidTvRemote"
private const val PAIRING_PORT = 6467
private const val REMOTE_PORT = 6466
private const val KEYSTORE_FILE = "atv_client.p12"
private const val KEYSTORE_PWD = "casacontrol"

// --- minimal protobuf wire helpers -----------------------------------------

private object Pb {
  fun varint(out: OutputStream, value: Long) {
    var x = value
    while (true) {
      val b = (x and 0x7F).toInt()
      x = x ushr 7
      if (x != 0L) out.write(b or 0x80) else { out.write(b); break }
    }
  }

  fun tag(out: OutputStream, field: Int, wire: Int) = varint(out, (field.toLong() shl 3) or wire.toLong())
  fun varintField(out: OutputStream, field: Int, value: Long) { tag(out, field, 0); varint(out, value) }
  fun lenField(out: OutputStream, field: Int, bytes: ByteArray) {
    tag(out, field, 2); varint(out, bytes.size.toLong()); out.write(bytes)
  }
  fun strField(out: OutputStream, field: Int, s: String) = lenField(out, field, s.toByteArray(Charsets.UTF_8))

  fun readVarint(ins: InputStream): Long {
    var shift = 0
    var result = 0L
    while (true) {
      val b = ins.read()
      if (b < 0) throw EOFException("stream closed")
      result = result or ((b.toLong() and 0x7F) shl shift)
      if (b and 0x80 == 0) break
      shift += 7
    }
    return result
  }

  /** Read one varint-length-prefixed message (the protocol's framing). */
  fun readFramed(ins: InputStream): ByteArray {
    val len = readVarint(ins).toInt()
    val buf = ByteArray(len)
    var off = 0
    while (off < len) {
      val n = ins.read(buf, off, len - off)
      if (n < 0) throw EOFException("stream closed mid-message")
      off += n
    }
    return buf
  }

  fun frame(payload: ByteArray): ByteArray {
    val out = ByteArrayOutputStream()
    varint(out, payload.size.toLong())
    out.write(payload)
    return out.toByteArray()
  }

  data class WireField(val num: Int, val wire: Int, val varint: Long, val bytes: ByteArray?)

  /** Shallow scan of a message's top-level fields. */
  fun scan(msg: ByteArray): List<WireField> {
    val ins = ByteArrayInputStream(msg)
    val out = ArrayList<WireField>()
    while (ins.available() > 0) {
      val tag = readVarint(ins)
      val num = (tag ushr 3).toInt()
      when ((tag and 7).toInt()) {
        0 -> out.add(WireField(num, 0, readVarint(ins), null))
        2 -> {
          val len = readVarint(ins).toInt()
          val b = ByteArray(len)
          var off = 0
          while (off < len) { val n = ins.read(b, off, len - off); if (n < 0) break; off += n }
          out.add(WireField(num, 2, 0, b))
        }
        5 -> { ins.skip(4); out.add(WireField(num, 5, 0, null)) }
        1 -> { ins.skip(8); out.add(WireField(num, 1, 0, null)) }
        else -> return out
      }
    }
    return out
  }

  fun field(msg: ByteArray, num: Int): WireField? = scan(msg).firstOrNull { it.num == num }
}

// --- crypto: persistent self-signed client cert -----------------------------

private object Certs {
  // Use our *bundled* BouncyCastle as a provider INSTANCE. Android ships a
  // stripped BouncyCastle already registered under the name "BC", so
  // Security.addProvider(BouncyCastleProvider()) is a silent no-op and looking
  // the provider up by name "BC" would resolve to Android's cut-down build,
  // which can't build an X.509 cert ("X.509 not found"). Passing the instance
  // straight to the JCA builders sidesteps the name-registry entirely.
  private val bc = BouncyCastleProvider()

  private var cache: KeyStore.PrivateKeyEntry? = null

  fun entry(ctx: Context): KeyStore.PrivateKeyEntry {
    cache?.let { return it }
    val ks = KeyStore.getInstance("PKCS12")
    val f = File(ctx.filesDir, KEYSTORE_FILE)
    if (f.exists()) {
      f.inputStream().use { ks.load(it, KEYSTORE_PWD.toCharArray()) }
    } else {
      ks.load(null, null)
      val (key, cert) = generate()
      ks.setKeyEntry("client", key, KEYSTORE_PWD.toCharArray(), arrayOf(cert))
      f.outputStream().use { ks.store(it, KEYSTORE_PWD.toCharArray()) }
    }
    val e = ks.getEntry("client", KeyStore.PasswordProtection(KEYSTORE_PWD.toCharArray()))
        as KeyStore.PrivateKeyEntry
    cache = e
    return e
  }

  private fun generate(): Pair<java.security.PrivateKey, X509Certificate> {
    val kpg = KeyPairGenerator.getInstance("RSA")
    kpg.initialize(2048, SecureRandom())
    val kp = kpg.generateKeyPair()
    val from = Date(System.currentTimeMillis() - 24L * 3600 * 1000)
    val to = Date(System.currentTimeMillis() + 20L * 365 * 24 * 3600 * 1000)
    val subject = X500Name("CN=CasaControl, OU=CasaControl, O=CasaControl, C=US")
    val serial = BigInteger.valueOf(System.currentTimeMillis())
    val builder = JcaX509v3CertificateBuilder(subject, serial, from, to, subject, kp.public)
    val signer = JcaContentSignerBuilder("SHA256withRSA").setProvider(bc).build(kp.private)
    val cert = JcaX509CertificateConverter().setProvider(bc).getCertificate(builder.build(signer))
    return kp.private to cert
  }

  /** Even-length big-endian hex bytes of a positive BigInteger (matches Python `bytes.fromhex(f"{n:X}")`). */
  fun modulusBytes(bi: BigInteger): ByteArray = hexToBytes(evenHex(bi.toString(16)))

  /** Exponent with a leading "0" nibble, matching Python `bytes.fromhex(f"0{e:X}")`. */
  fun exponentBytes(bi: BigInteger): ByteArray = hexToBytes(evenHex("0" + bi.toString(16)))

  private fun evenHex(h: String): String = if (h.length % 2 == 1) "0$h" else h
  fun hexToBytes(h: String): ByteArray =
    ByteArray(h.length / 2) { ((h[it * 2].digitToInt(16) shl 4) or h[it * 2 + 1].digitToInt(16)).toByte() }
}

// --- TLS helpers ------------------------------------------------------------

private fun trustAllContext(ctx: Context): SSLContext {
  val entry = Certs.entry(ctx)
  val ks = KeyStore.getInstance("PKCS12").apply {
    load(null, null)
    setKeyEntry("client", entry.privateKey, KEYSTORE_PWD.toCharArray(), entry.certificateChain)
  }
  val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm())
  kmf.init(ks, KEYSTORE_PWD.toCharArray())
  val trustAll = object : X509TrustManager {
    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
    override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
  }
  return SSLContext.getInstance("TLS").apply {
    init(kmf.keyManagers, arrayOf<javax.net.ssl.TrustManager>(trustAll), SecureRandom())
  }
}

private fun openSocket(ctx: Context, host: String, port: Int): SSLSocket {
  val socket = trustAllContext(ctx).socketFactory.createSocket(host, port) as SSLSocket
  socket.soTimeout = 0
  socket.startHandshake()
  return socket
}

// --- the module -------------------------------------------------------------

class AndroidTvRemoteModule : Module() {
  private val io = Executors.newCachedThreadPool()

  // Pairing state (port 6467).
  private var pairSocket: SSLSocket? = null
  private var pairOut: OutputStream? = null
  private var clientCert: X509Certificate? = null
  private var serverCert: X509Certificate? = null
  private var awaitingCodePromise: Promise? = null
  private var secretPromise: Promise? = null

  // Remote state (port 6466).
  private var remoteSocket: SSLSocket? = null
  private var remoteOut: OutputStream? = null
  private val writeLock = Any()

  @Volatile private var link: String = "disconnected"
  @Volatile private var host: String? = null
  @Volatile private var powered: Boolean? = null

  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "No Android context" }

  override fun definition() = ModuleDefinition {
    Name("AndroidTvRemote")
    Events("onState")

    AsyncFunction("startPairing") { h: String, clientName: String, promise: Promise ->
      io.execute { startPairing(h, clientName, promise) }
    }

    AsyncFunction("sendPairingCode") { code: String, promise: Promise ->
      io.execute { sendPairingCode(code, promise) }
    }

    AsyncFunction("connect") { h: String, promise: Promise ->
      io.execute {
        try {
          ensureRemote(h)
          promise.resolve(null)
        } catch (e: Exception) {
          promise.reject("ERR_CONNECT", e.message ?: "connect failed", e)
        }
      }
    }

    AsyncFunction("sendKey") { keyCode: Int, promise: Promise ->
      io.execute {
        try {
          val h = host ?: throw IllegalStateException("not connected")
          ensureRemote(h)
          sendKeyPress(keyCode)
          promise.resolve(null)
        } catch (e: Exception) {
          promise.reject("ERR_KEY", e.message ?: "sendKey failed", e)
        }
      }
    }

    AsyncFunction("launchApp") { appLink: String, promise: Promise ->
      io.execute {
        try {
          val h = host ?: throw IllegalStateException("not connected")
          ensureRemote(h)
          sendAppLink(appLink)
          promise.resolve(null)
        } catch (e: Exception) {
          promise.reject("ERR_LAUNCH", e.message ?: "launchApp failed", e)
        }
      }
    }

    Function("isPaired") { h: String -> pairedHosts().contains(h) }

    // The most recently paired host (persisted) — lets the hub resolve a stable
    // target even when live LAN discovery momentarily drops the Shield.
    Function("pairedHost") { pairedHosts().firstOrNull() }

    Function("status") {
      mapOf("link" to link, "host" to host, "powered" to powered)
    }

    Function("disconnect") {
      closeRemote()
      closePairing()
      setLink("disconnected")
    }

    OnDestroy {
      closeRemote()
      closePairing()
      io.shutdownNow()
    }
  }

  // --- pairing ---------------------------------------------------------------

  private fun startPairing(h: String, clientName: String, promise: Promise) {
    try {
      closePairing()
      host = h
      setLink("pairing")
      val socket = openSocket(context, h, PAIRING_PORT)
      clientCert = Certs.entry(context).certificate as X509Certificate
      serverCert = socket.session.peerCertificates[0] as X509Certificate
      pairSocket = socket
      pairOut = socket.outputStream
      awaitingCodePromise = promise

      // Kick off the handshake, then let the reader drive the state machine.
      writeFramed(pairOut!!, pairingMessage { Pb.lenField(it, 10, pairingRequest(clientName)) })

      val ins = socket.inputStream
      io.execute {
        try {
          while (true) {
            val msg = Pb.readFramed(ins)
            onPairingMessage(msg)
          }
        } catch (e: Exception) {
          // Socket closed. Fail any in-flight promise not yet settled.
          awaitingCodePromise?.reject("ERR_PAIR", e.message ?: "pairing closed", e)
          awaitingCodePromise = null
          secretPromise?.reject("ERR_PAIR", e.message ?: "pairing closed", e)
          secretPromise = null
        }
      }
    } catch (e: Exception) {
      setLink("unpaired")
      promise.reject("ERR_PAIR", e.message ?: "pairing failed", e)
    }
  }

  private fun onPairingMessage(msg: ByteArray) {
    val status = Pb.field(msg, 2)?.varint ?: 200
    if (status != 200L) {
      awaitingCodePromise?.reject("ERR_PAIR", "TV returned status $status", null)
      awaitingCodePromise = null
      secretPromise?.reject("ERR_PAIR", "TV returned status $status", null)
      secretPromise = null
      return
    }
    val fields = Pb.scan(msg).map { it.num }.toSet()
    when {
      // pairing_request_ack -> send option
      fields.contains(11) -> writeFramed(pairOut!!, pairingMessage { Pb.lenField(it, 20, pairingOption()) })
      // pairing_option (echo) -> send configuration
      fields.contains(20) -> writeFramed(pairOut!!, pairingMessage { Pb.lenField(it, 30, pairingConfiguration()) })
      // pairing_configuration_ack -> TV now shows the code
      fields.contains(31) -> {
        awaitingCodePromise?.resolve(null)
        awaitingCodePromise = null
      }
      // pairing_secret_ack -> paired
      fields.contains(41) -> {
        rememberPaired(host)
        secretPromise?.resolve(null)
        secretPromise = null
        closePairing()
        // Immediately open the control channel so keys work right away.
        try {
          ensureRemote(host!!)
        } catch (_: Exception) { /* the phone can retry connect */ }
      }
    }
  }

  private fun sendPairingCode(code: String, promise: Promise) {
    try {
      val out = pairOut ?: throw IllegalStateException("no active pairing")
      val clean = code.trim().lowercase()
      require(clean.length >= 6) { "code must be 6 characters" }
      val hash = secretHash(clean)
      val check = clean.substring(0, 2).toInt(16)
      if ((hash[0].toInt() and 0xFF) != check) {
        throw IllegalArgumentException("that code doesn't match — re-check the TV")
      }
      secretPromise = promise
      writeFramed(out, pairingMessage { Pb.lenField(it, 40, pairingSecret(hash)) })
    } catch (e: Exception) {
      promise.reject("ERR_CODE", e.message ?: "bad code", e)
    }
  }

  /** SHA-256(clientMod || clientExp || serverMod || serverExp || nonce). */
  private fun secretHash(code: String): ByteArray {
    val client = clientCert!!.publicKey as RSAPublicKey
    val server = serverCert!!.publicKey as RSAPublicKey
    val nonce = Certs.hexToBytes(code.substring(2, 6))
    val md = MessageDigest.getInstance("SHA-256")
    md.update(Certs.modulusBytes(client.modulus))
    md.update(Certs.exponentBytes(client.publicExponent))
    md.update(Certs.modulusBytes(server.modulus))
    md.update(Certs.exponentBytes(server.publicExponent))
    md.update(nonce)
    return md.digest()
  }

  // Pairing message builders.
  private fun pairingMessage(body: (OutputStream) -> Unit): ByteArray {
    val out = ByteArrayOutputStream()
    Pb.varintField(out, 1, 2)      // protocol_version = 2
    Pb.varintField(out, 2, 200)    // status = STATUS_OK
    body(out)
    return out.toByteArray()
  }

  private fun pairingRequest(clientName: String): ByteArray {
    val out = ByteArrayOutputStream()
    Pb.strField(out, 1, "androidtv-remote") // service_name
    Pb.strField(out, 2, clientName)         // client_name
    return out.toByteArray()
  }

  private fun encoding(): ByteArray {
    val out = ByteArrayOutputStream()
    Pb.varintField(out, 1, 3) // type = HEXADECIMAL
    Pb.varintField(out, 2, 6) // symbol_length
    return out.toByteArray()
  }

  private fun pairingOption(): ByteArray {
    val out = ByteArrayOutputStream()
    Pb.lenField(out, 1, encoding()) // input_encoding
    Pb.varintField(out, 3, 1)       // preferred_role = ROLE_INPUT
    return out.toByteArray()
  }

  private fun pairingConfiguration(): ByteArray {
    val out = ByteArrayOutputStream()
    Pb.lenField(out, 1, encoding()) // encoding
    Pb.varintField(out, 2, 1)       // client_role = ROLE_INPUT
    return out.toByteArray()
  }

  private fun pairingSecret(hash: ByteArray): ByteArray {
    val out = ByteArrayOutputStream()
    Pb.lenField(out, 1, hash) // secret
    return out.toByteArray()
  }

  // --- remote control --------------------------------------------------------

  @Synchronized
  private fun ensureRemote(h: String) {
    if (remoteSocket != null && !remoteSocket!!.isClosed && host == h && link == "connected") return
    closeRemote()
    host = h
    val socket = openSocket(context, h, REMOTE_PORT)
    remoteSocket = socket
    remoteOut = socket.outputStream
    val ins = socket.inputStream
    io.execute {
      try {
        while (true) onRemoteMessage(Pb.readFramed(ins))
      } catch (_: Exception) {
        if (remoteSocket === socket) {
          closeRemote()
          setLink(if (pairedHosts().contains(h)) "disconnected" else "unpaired")
        }
      }
    }
    // Wait briefly for the configure handshake to flip us to "connected".
    val deadline = System.currentTimeMillis() + 4000
    while (link != "connected" && System.currentTimeMillis() < deadline) Thread.sleep(50)
    if (link != "connected") throw IllegalStateException("TV did not complete the handshake")
  }

  private fun onRemoteMessage(msg: ByteArray) {
    val fields = Pb.scan(msg)
    val nums = fields.map { it.num }.toSet()
    when {
      // remote_configure -> reply with our device info + go active
      nums.contains(1) -> {
        writeFramedRemote(remoteMessage { Pb.lenField(it, 1, remoteConfigure()) })
        writeFramedRemote(remoteMessage { Pb.lenField(it, 2, remoteSetActive()) })
        setLink("connected")
      }
      // ping -> pong (echo val1)
      nums.contains(8) -> {
        val ping = fields.first { it.num == 8 }.bytes ?: ByteArray(0)
        val val1 = Pb.field(ping, 1)?.varint ?: 1
        writeFramedRemote(remoteMessage { Pb.lenField(it, 9, remotePingResponse(val1)) })
      }
      // remote_start -> power state
      nums.contains(40) -> {
        val start = fields.first { it.num == 40 }.bytes ?: ByteArray(0)
        powered = (Pb.field(start, 1)?.varint ?: 0L) != 0L
        emitState()
      }
    }
  }

  private fun sendKeyPress(keyCode: Int) {
    // START_LONG (1) then END_LONG (2) = a short click.
    writeFramedRemote(remoteMessage { Pb.lenField(it, 10, keyInject(keyCode, 1)) })
    writeFramedRemote(remoteMessage { Pb.lenField(it, 10, keyInject(keyCode, 2)) })
  }

  private fun sendAppLink(appLink: String) {
    writeFramedRemote(remoteMessage { Pb.lenField(it, 90, appLinkLaunch(appLink)) })
  }

  private fun remoteMessage(body: (OutputStream) -> Unit): ByteArray {
    val out = ByteArrayOutputStream()
    body(out)
    return out.toByteArray()
  }

  private fun remoteConfigure(): ByteArray {
    val out = ByteArrayOutputStream()
    Pb.varintField(out, 1, 622) // code1
    Pb.lenField(out, 2, remoteDeviceInfo())
    return out.toByteArray()
  }

  private fun remoteDeviceInfo(): ByteArray {
    val out = ByteArrayOutputStream()
    Pb.strField(out, 1, "CasaControl")            // model
    Pb.strField(out, 2, "CasaControl")            // vendor
    Pb.varintField(out, 3, 1)                     // unknown1
    Pb.strField(out, 4, "1")                      // unknown2
    Pb.strField(out, 5, "com.casacontrol.tablet") // package_name
    Pb.strField(out, 6, "1.0.0")                  // app_version
    return out.toByteArray()
  }

  private fun remoteSetActive(): ByteArray {
    val out = ByteArrayOutputStream()
    Pb.varintField(out, 1, 622)
    return out.toByteArray()
  }

  private fun remotePingResponse(val1: Long): ByteArray {
    val out = ByteArrayOutputStream()
    Pb.varintField(out, 1, val1)
    return out.toByteArray()
  }

  private fun keyInject(keyCode: Int, direction: Int): ByteArray {
    val out = ByteArrayOutputStream()
    Pb.varintField(out, 1, keyCode.toLong()) // key_code
    Pb.varintField(out, 2, direction.toLong()) // direction
    return out.toByteArray()
  }

  private fun appLinkLaunch(appLink: String): ByteArray {
    val out = ByteArrayOutputStream()
    Pb.strField(out, 1, appLink)
    return out.toByteArray()
  }

  // --- plumbing --------------------------------------------------------------

  private fun writeFramed(out: OutputStream, payload: ByteArray) {
    synchronized(writeLock) {
      out.write(Pb.frame(payload))
      out.flush()
    }
  }

  private fun writeFramedRemote(payload: ByteArray) {
    val out = remoteOut ?: throw IllegalStateException("not connected")
    writeFramed(out, payload)
  }

  private fun closePairing() {
    try { pairSocket?.close() } catch (_: Exception) {}
    pairSocket = null
    pairOut = null
  }

  private fun closeRemote() {
    try { remoteSocket?.close() } catch (_: Exception) {}
    remoteSocket = null
    remoteOut = null
  }

  private fun setLink(next: String) {
    link = next
    emitState()
  }

  private fun emitState() {
    sendEvent("onState", mapOf("link" to link, "host" to host, "powered" to powered))
  }

  // Persist which hosts we've paired with (for a quick "paired?" check).
  private fun prefs() = context.getSharedPreferences("atv_remote", Context.MODE_PRIVATE)
  private fun pairedHosts(): Set<String> = prefs().getStringSet("paired", emptySet()) ?: emptySet()
  private fun rememberPaired(h: String?) {
    if (h == null) return
    prefs().edit().putStringSet("paired", pairedHosts() + h).apply()
  }
}

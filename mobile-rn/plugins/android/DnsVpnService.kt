package com.touchgrass.touchgrassrn
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.content.pm.ServiceInfo
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketTimeoutException
import java.util.concurrent.Executors

/** A local, DNS-only filter. It deliberately does not tunnel general app traffic. */
class DnsVpnService : VpnService() {
    companion object {
        const val ACTION_START = "com.touchgrass.action.START_DNS_VPN"
        const val ACTION_STOP = "com.touchgrass.action.STOP_DNS_VPN"
        const val PREFS = "grounded_mode"
        const val KEY_RUNNING = "dns_vpn_running"
        private const val CHANNEL_ID = "grounded_mode"
        private const val NOTIFICATION_ID = 71
        private const val VPN_ADDRESS = "10.66.0.1"
        private const val VPN_DNS = "10.66.0.2"
        private val blockedDomains = listOf("instagram.com", "tiktok.com", "x.com", "reddit.com", "snapchat.com", "facebook.com", "youtube.com", "youtu.be")
        @Volatile var isActive = false
    }

    @Volatile private var tunnel: ParcelFileDescriptor? = null
    @Volatile private var active = false
    private val worker = Executors.newSingleThreadExecutor()

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> stopTunnel()
            ACTION_START -> if (!active) startTunnel()
        }
        return START_NOT_STICKY
    }

    private fun startTunnel() {
        try {
            val descriptor = Builder()
                .setSession("TouchGrass DNS filter")
                .setMtu(1500)
                .addAddress(VPN_ADDRESS, 32)
                .addRoute(VPN_DNS, 32)
                .addDnsServer(VPN_DNS)
                .establish()

            if (descriptor == null) {
                stopSelf()
                return
            }

            tunnel = descriptor
            active = true
            isActive = true
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(KEY_RUNNING, true).apply()
            promoteToForeground()
            worker.execute { readDnsPackets(descriptor) }
        } catch (_: Exception) {
            stopTunnel()
        }
    }

    private fun promoteToForeground() {
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Grounded Mode", NotificationManager.IMPORTANCE_LOW))
        }
        val openApp = PendingIntent.getActivity(
            this,
            0,
            packageManager.getLaunchIntentForPackage(packageName),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification: Notification = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_lock_lock)
                .setContentTitle("TouchGrass is keeping you grounded")
                .setContentText("DNS filtering is active. Tap to manage it.")
                .setContentIntent(openApp)
                .setOngoing(true)
                .build()
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
                .setSmallIcon(android.R.drawable.ic_lock_lock)
                .setContentTitle("TouchGrass is keeping you grounded")
                .setContentText("DNS filtering is active. Tap to manage it.")
                .setContentIntent(openApp)
                .setOngoing(true)
                .build()
        }

        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun readDnsPackets(descriptor: ParcelFileDescriptor) {
        val input = FileInputStream(descriptor.fileDescriptor)
        val output = FileOutputStream(descriptor.fileDescriptor)
        val buffer = ByteArray(32767)
        try {
            while (active) {
                val size = input.read(buffer)
                if (size <= 0) continue
                val response = handleIpv4UdpDns(buffer.copyOf(size)) ?: continue
                output.write(response)
            }
        } catch (_: Exception) {
            if (active) stopTunnel()
        }
    }

    private fun handleIpv4UdpDns(packet: ByteArray): ByteArray? {
        if (packet.size < 28 || packet[0].toInt() ushr 4 != 4) return null
        val ipHeaderLength = (packet[0].toInt() and 0x0f) * 4
        if (ipHeaderLength < 20 || packet.size < ipHeaderLength + 8 || packet[9].toInt() and 0xff != 17) return null
        val udpLength = u16(packet, ipHeaderLength + 4)
        if (udpLength < 8 || ipHeaderLength + udpLength > packet.size) return null
        val dnsStart = ipHeaderLength + 8
        val dns = packet.copyOfRange(dnsStart, ipHeaderLength + udpLength)
        val domain = questionName(dns) ?: return null
        val answer = if (isBlockedDomain(domain)) {
            blockedResponse(dns) ?: return null
        } else {
            forwardToResolver(dns) ?: return null
        }
        return udpReply(packet, ipHeaderLength, answer)
    }

    private fun isBlockedDomain(domain: String): Boolean {
        val key = when {
            domain == "instagram.com" || domain.endsWith(".instagram.com") -> "instagram"
            domain == "tiktok.com" || domain.endsWith(".tiktok.com") -> "tiktok"
            domain == "x.com" || domain.endsWith(".x.com") -> "x"
            domain == "reddit.com" || domain.endsWith(".reddit.com") -> "reddit"
            domain == "snapchat.com" || domain.endsWith(".snapchat.com") -> "snapchat"
            domain == "facebook.com" || domain.endsWith(".facebook.com") || domain == "fb.com" || domain.endsWith(".fb.com") -> "facebook"
            domain == "youtube.com" || domain.endsWith(".youtube.com") || domain == "youtu.be" || domain.endsWith(".youtu.be") -> "youtube"
            else -> return false
        }
        val limits = getSharedPreferences(PREFS, MODE_PRIVATE).getString("grant_$key", null)?.split(":") ?: return true
        if (limits.size != 2) return true
        val usable = limits[0].toLongOrNull() ?: return true
        val expires = limits[1].toLongOrNull() ?: return true
        val now = System.currentTimeMillis()
        return !(now >= usable && now < expires)
    }

    private fun forwardToResolver(query: ByteArray): ByteArray? {
        return try {
            DatagramSocket().use { socket ->
                if (!protect(socket)) return null
                socket.soTimeout = 2500
                val resolver = InetAddress.getByName("1.1.1.1")
                socket.send(DatagramPacket(query, query.size, resolver, 53))
                val response = ByteArray(4096)
                val reply = DatagramPacket(response, response.size)
                socket.receive(reply)
                response.copyOf(reply.length)
            }
        } catch (_: SocketTimeoutException) {
            null
        } catch (_: Exception) {
            null
        }
    }

    private fun questionName(message: ByteArray): String? {
        if (message.size < 17 || u16(message, 4) < 1) return null
        val labels = mutableListOf<String>()
        var cursor = 12
        while (cursor < message.size) {
            val length = message[cursor++].toInt() and 0xff
            if (length == 0) {
                if (cursor + 4 > message.size) return null
                return labels.joinToString(".").lowercase()
            }
            if (length > 63 || cursor + length > message.size) return null
            labels += message.copyOfRange(cursor, cursor + length).toString(Charsets.US_ASCII)
            cursor += length
        }
        return null
    }

    private fun blockedResponse(query: ByteArray): ByteArray? {
        val nameEnd = questionEnd(query) ?: return null
        val response = query.copyOfRange(0, nameEnd)
        response[2] = (response[2].toInt() or 0x80).toByte() // response
        response[3] = ((response[3].toInt() and 0xf0) or 0x83).toByte() // recursion available + NXDOMAIN
        response[6] = 0; response[7] = 0 // no answers
        response[8] = 0; response[9] = 0 // no authority records
        response[10] = 0; response[11] = 0 // no additional records
        return response
    }

    private fun questionEnd(message: ByteArray): Int? {
        var cursor = 12
        while (cursor < message.size) {
            val length = message[cursor++].toInt() and 0xff
            if (length == 0) return if (cursor + 4 <= message.size) cursor + 4 else null
            if (length > 63 || cursor + length > message.size) return null
            cursor += length
        }
        return null
    }

    private fun udpReply(request: ByteArray, ipLength: Int, dns: ByteArray): ByteArray {
        val udpLength = 8 + dns.size
        val response = ByteArray(ipLength + udpLength)
        response[0] = ((4 shl 4) or (ipLength / 4)).toByte()
        response[1] = 0
        put16(response, 2, response.size)
        put16(response, 4, 0)
        put16(response, 6, 0x4000) // don't fragment
        response[8] = 64
        response[9] = 17
        request.copyInto(response, 12, 16, 20) // reply source = request destination
        request.copyInto(response, 16, 12, 16) // reply destination = request source
        put16(response, 10, checksum(response, 0, ipLength))
        put16(response, ipLength, u16(request, ipLength + 2))
        put16(response, ipLength + 2, u16(request, ipLength))
        put16(response, ipLength + 4, udpLength)
        put16(response, ipLength + 6, 0) // optional for IPv4 UDP
        dns.copyInto(response, ipLength + 8)
        return response
    }

    private fun checksum(bytes: ByteArray, offset: Int, length: Int): Int {
        var sum = 0L
        var i = offset
        while (i < offset + length) {
            val high = bytes[i].toInt() and 0xff
            val low = if (i + 1 < offset + length) bytes[i + 1].toInt() and 0xff else 0
            sum += (high shl 8) or low
            i += 2
        }
        while (sum ushr 16 != 0L) sum = (sum and 0xffff) + (sum ushr 16)
        return sum.inv().toInt() and 0xffff
    }

    private fun u16(bytes: ByteArray, offset: Int): Int =
        ((bytes[offset].toInt() and 0xff) shl 8) or (bytes[offset + 1].toInt() and 0xff)

    private fun put16(bytes: ByteArray, offset: Int, value: Int) {
        bytes[offset] = (value ushr 8).toByte()
        bytes[offset + 1] = value.toByte()
    }

    private fun stopTunnel() {
        active = false
        isActive = false
        try { tunnel?.close() } catch (_: Exception) { }
        tunnel = null
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(KEY_RUNNING, false).apply()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        stopSelf()
    }

    override fun onRevoke() {
        stopTunnel()
        super.onRevoke()
    }

    override fun onDestroy() {
        active = false
        isActive = false
        try { tunnel?.close() } catch (_: Exception) { }
        tunnel = null
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(KEY_RUNNING, false).apply()
        worker.shutdownNow()
        super.onDestroy()
    }
}

package com.hisaabcheck.app.ui

import android.graphics.BitmapFactory
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import com.hisaabcheck.app.adapters.BitmapPainter
import com.hisaabcheck.core.ImageInput
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import com.hisaabcheck.core.Box as ImgBox

private class Decoded(val bitmap: ImageBitmap, val w: Int, val h: Int)

// Extra boxes are kept in image pixels; the saver lets them survive rotation.
private val BoxListSaver: Saver<SnapshotStateList<ImgBox>, Any> = Saver(
    save = { list -> ArrayList<Double>(list.flatMap { listOf(it.x0, it.y0, it.x1, it.y1) }) },
    restore = { saved ->
        @Suppress("UNCHECKED_CAST")
        val flat = saved as List<Double>
        mutableStateListOf<ImgBox>().apply { flat.chunked(4).forEach { add(ImgBox(it[0], it[1], it[2], it[3])) } }
    },
)

/** Shows ONLY the redacted image. Extra boxes are painted onto that redacted image; the original is never available here. */
@Composable
fun PreviewScreen(redacted: ByteArray, onSend: (ByteArray) -> Unit, onKeep: () -> Unit) {
    val decoded by produceState<Decoded?>(null, redacted) {
        value = withContext(Dispatchers.Default) {
            val bmp = BitmapFactory.decodeByteArray(redacted, 0, redacted.size)
            bmp?.let { Decoded(it.asImageBitmap(), it.width, it.height) }
        }
    }
    val boxes = rememberSaveable(saver = BoxListSaver) { mutableStateListOf<ImgBox>() }
    var drag by remember { mutableStateOf<ImgBox?>(null) }
    var shown by remember { mutableStateOf(IntSize.Zero) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    // Back never sends anything: it keeps the bill on the phone.
    BackHandler { onKeep() }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Send to cloud?", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.semantics { heading() })
        Text(
            "This is the bill as the cloud would see it, with private numbers we found blacked out. " +
                "We could not be sure we found them all, so check it and drag over anything else to hide it.",
        )
        val d = decoded
        if (d == null) {
            Text("Loading the image\u2026")
        } else {
            fun toImage(p: Offset): Offset {
                val sw = shown.width.coerceAtLeast(1).toFloat()
                val sh = shown.height.coerceAtLeast(1).toFloat()
                return Offset((p.x / sw * d.w).coerceIn(0f, d.w.toFloat()), (p.y / sh * d.h).coerceIn(0f, d.h.toFloat()))
            }
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(d.w.toFloat() / d.h.toFloat())
                    .onSizeChanged { shown = it }
                    .pointerInput(d, busy) {
                        if (busy) return@pointerInput
                        var start = Offset.Zero
                        detectDragGestures(
                            onDragStart = { p -> start = toImage(p); drag = ImgBox(start.x.toDouble(), start.y.toDouble(), start.x.toDouble(), start.y.toDouble()) },
                            onDrag = { change, _ ->
                                val p = toImage(change.position)
                                drag = ImgBox(start.x.toDouble(), start.y.toDouble(), p.x.toDouble(), p.y.toDouble())
                            },
                            onDragEnd = {
                                drag?.let { b -> normalised(b).takeIf { it.x1 - it.x0 > 2 && it.y1 - it.y0 > 2 }?.let { boxes.add(it) } }
                                drag = null
                            },
                            onDragCancel = { drag = null },
                        )
                    },
            ) {
                Image(
                    bitmap = d.bitmap,
                    contentDescription = "Bill with private numbers blacked out. This is what would be sent to the cloud.",
                    modifier = Modifier.fillMaxSize(),
                )
                Canvas(modifier = Modifier.fillMaxSize()) {
                    val sx = size.width / d.w
                    val sy = size.height / d.h
                    for (b in boxes + listOfNotNull(drag)) {
                        val n = normalised(b)
                        val topLeft = Offset((n.x0 * sx).toFloat(), (n.y0 * sy).toFloat())
                        val sz = Size(((n.x1 - n.x0) * sx).toFloat(), ((n.y1 - n.y0) * sy).toFloat())
                        drawRect(Color.Black, topLeft, sz)
                        drawRect(Color.White, topLeft, sz, style = Stroke(width = 2f)) // outline so a box shows on a dark area
                    }
                }
            }
            Text(
                "${boxes.size} extra box${if (boxes.size == 1) "" else "es"} added",
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
            if (error) {
                Text(
                    "Could not prepare the image. Try again or keep it on your phone.",
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive },
                )
            }
            Button(
                onClick = {
                    busy = true
                    error = false
                    scope.launch {
                        try {
                            val extra = boxes.map { clampBox(it, d.w, d.h) }
                            // With no extra boxes the redacted image goes as it is.
                            val out = if (extra.isEmpty()) redacted else BitmapPainter().paint(ImageInput(redacted, d.w, d.h), extra)
                            onSend(out)
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            busy = false
                            error = true
                        }
                    }
                },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
            ) { Text(if (busy) "Preparing\u2026" else "Send to cloud") }
            TextButton(
                onClick = { if (boxes.isNotEmpty()) boxes.removeAt(boxes.lastIndex) },
                enabled = boxes.isNotEmpty() && !busy,
                modifier = Modifier.heightIn(min = 48.dp),
            ) { Text("Undo last box") }
            TextButton(
                onClick = { boxes.add(ImgBox(0.0, Math.round(d.h * 0.66667).toDouble(), d.w.toDouble(), d.h.toDouble())) },
                enabled = !busy,
                modifier = Modifier.heightIn(min = 48.dp),
            ) { Text("Black out bottom third") }
        }
        // Always available, even if the image could not be decoded: keeping the bill on the phone sends nothing.
        OutlinedButton(onClick = onKeep, enabled = !busy, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) { Text("Keep on device") }
    }
}

private fun normalised(b: ImgBox) = ImgBox(minOf(b.x0, b.x1), minOf(b.y0, b.y1), maxOf(b.x0, b.x1), maxOf(b.y0, b.y1))

private fun clampBox(b: ImgBox, w: Int, h: Int): ImgBox {
    val n = normalised(b)
    return ImgBox(n.x0.coerceIn(0.0, w.toDouble()), n.y0.coerceIn(0.0, h.toDouble()), n.x1.coerceIn(0.0, w.toDouble()), n.y1.coerceIn(0.0, h.toDouble()))
}

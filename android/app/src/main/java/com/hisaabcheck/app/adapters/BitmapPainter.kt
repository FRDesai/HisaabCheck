package com.hisaabcheck.app.adapters

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import com.hisaabcheck.core.Box
import com.hisaabcheck.core.ImageInput
import com.hisaabcheck.core.Painter
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Paints solid black rectangles over the given boxes and returns new JPEG bytes. The input array is never returned. */
class BitmapPainter : Painter {
    override suspend fun paint(image: ImageInput, boxes: List<Box>): ByteArray = withContext(Dispatchers.Default) {
        val src = BitmapFactory.decodeByteArray(image.bytes, 0, image.bytes.size) ?: error("cannot decode image")
        val canvasBitmap = src.copy(Bitmap.Config.ARGB_8888, true) ?: error("cannot copy image")
        val canvas = Canvas(canvasBitmap)
        val paint = Paint().apply {
            color = Color.BLACK
            style = Paint.Style.FILL
            isAntiAlias = false
        }
        for (b in boxes) {
            canvas.drawRect(b.x0.toFloat(), b.y0.toFloat(), b.x1.toFloat(), b.y1.toFloat(), paint)
        }
        val out = ByteArrayOutputStream()
        check(canvasBitmap.compress(Bitmap.CompressFormat.JPEG, 90, out)) { "cannot encode image" }
        out.toByteArray()
    }
}

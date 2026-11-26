package com.hisaabcheck.app.adapters

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import com.hisaabcheck.core.ImageInput
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Loads a picked or captured photo as an upright JPEG whose longest side is at most [maxSide] pixels. */
object ImageLoader {
    suspend fun load(context: Context, uri: Uri, maxSide: Int = 1600): ImageInput = withContext(Dispatchers.IO) {
        val resolver = context.applicationContext.contentResolver

        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(uri).use { BitmapFactory.decodeStream(it ?: error("cannot open image"), null, bounds) }
        require(bounds.outWidth > 0 && bounds.outHeight > 0) { "not an image" }

        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2
        val opts = BitmapFactory.Options().apply {
            inSampleSize = sample
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        val decoded = resolver.openInputStream(uri).use { BitmapFactory.decodeStream(it ?: error("cannot open image"), null, opts) }
            ?: error("cannot decode image")

        val orientation = resolver.openInputStream(uri).use { s ->
            if (s == null) ExifInterface.ORIENTATION_NORMAL
            else try {
                ExifInterface(s).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
            } catch (e: Exception) {
                ExifInterface.ORIENTATION_NORMAL
            }
        }

        val matrix = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
            ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
            ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> { matrix.postRotate(90f); matrix.postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_TRANSVERSE -> { matrix.postRotate(-90f); matrix.postScale(-1f, 1f) }
        }
        // Scale so the longest side (after sampling, which only gets within a factor of two) is at most maxSide.
        val longest = maxOf(decoded.width, decoded.height)
        if (longest > maxSide) {
            val f = maxSide.toFloat() / longest
            matrix.postScale(f, f)
        }

        val upright = if (matrix.isIdentity) decoded
        else Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
        // createBitmap may round up by a pixel; clamp so the limit is a hard guarantee.
        val bitmap = if (maxOf(upright.width, upright.height) > maxSide) {
            val f = maxSide.toFloat() / maxOf(upright.width, upright.height)
            Bitmap.createScaledBitmap(upright, maxOf(1, (upright.width * f).toInt()), maxOf(1, (upright.height * f).toInt()), true)
        } else upright

        val out = ByteArrayOutputStream()
        check(bitmap.compress(Bitmap.CompressFormat.JPEG, 90, out)) { "cannot encode image" }
        ImageInput(out.toByteArray(), bitmap.width, bitmap.height)
    }
}

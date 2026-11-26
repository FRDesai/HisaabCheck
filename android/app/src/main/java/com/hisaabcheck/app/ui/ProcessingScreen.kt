package com.hisaabcheck.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hisaabcheck.core.Step

private val STEPS: List<Pair<Step, String>> = listOf(
    Step.AVAILABILITY to "Checking device AI",
    Step.DEVICE_READ to "Reading on device",
    Step.CHECKING to "Checking maths",
    Step.REDACTING to "Hiding private numbers",
    Step.AWAITING_CONSENT to "Waiting for you",
    Step.CLOUD_READ to "Reading in cloud",
    Step.DONE to "Saved",
)

@Composable
fun ProcessingScreen(step: Step) {
    val current = STEPS.indexOfFirst { it.first == step }
    val currentLabel = STEPS.getOrNull(current)?.second ?: "Working"
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CircularProgressIndicator(modifier = Modifier.semantics { contentDescription = "Working on your bill" })
        // The live region makes a screen reader announce each step as it changes.
        Text(
            text = "Step: $currentLabel",
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            STEPS.forEachIndexed { i, (_, label) ->
                val state = when {
                    i < current -> "done"
                    i == current -> "now"
                    else -> "waiting"
                }
                val mark = when (state) {
                    "done" -> "\u2713 "
                    "now" -> "\u25B6 "
                    else -> "\u2022 "
                }
                Text(
                    text = mark + label,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = if (state == "now") FontWeight.Bold else FontWeight.Normal,
                    color = if (state == "waiting") MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.heightIn(min = 32.dp).semantics { stateDescription = state },
                )
            }
        }
    }
}

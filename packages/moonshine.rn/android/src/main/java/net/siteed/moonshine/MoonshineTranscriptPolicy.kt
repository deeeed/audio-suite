package net.siteed.moonshine

import ai.moonshine.voice.SpeakerSpan
import ai.moonshine.voice.TranscriptLine

internal object MoonshineTranscriptPolicy {
  fun applyLine(
    line: TranscriptLine,
    linesById: LinkedHashMap<Long, TranscriptLine>,
    completedLineIds: MutableSet<Long>
  ): List<String> {
    val wasCompleted = completedLineIds.contains(line.id)
    linesById[line.id] = line
    if (line.isComplete) {
      completedLineIds.add(line.id)
    }
    return eventTypes(line, wasCompleted)
  }

  fun dominantSpeakerSpan(line: TranscriptLine): SpeakerSpan? {
    return line.speakerSpans.orEmpty().maxByOrNull { it.duration }
  }

  private fun eventTypes(line: TranscriptLine, wasCompleted: Boolean): List<String> {
    val events = mutableListOf<String>()
    if (line.isNew) {
      events.add("lineStarted")
    }
    if (
      !line.isNew &&
      ((line.isUpdated && !line.isComplete) || (line.haveSpeakersChanged && wasCompleted))
    ) {
      events.add("lineUpdated")
    }
    if (line.hasTextChanged) {
      events.add("lineTextChanged")
    }
    if (line.isComplete && line.isUpdated && !wasCompleted) {
      events.add("lineCompleted")
    }
    return events
  }
}

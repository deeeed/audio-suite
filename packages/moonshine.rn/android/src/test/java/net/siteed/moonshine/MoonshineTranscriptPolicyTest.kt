package net.siteed.moonshine

import ai.moonshine.voice.SpeakerSpan
import ai.moonshine.voice.TranscriptLine
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MoonshineTranscriptPolicyTest {
  @Test
  fun completedSpeakerRevisionEmitsUpdateWithoutRepeatingCompletion() {
    val original = TranscriptLine().apply {
      id = 42
      isComplete = true
      isUpdated = true
      speakerSpans = listOf(speakerSpan(id = 10, index = 0, duration = 2f))
    }
    val revision = TranscriptLine().apply {
      id = 42
      isComplete = true
      isUpdated = true
      haveSpeakersChanged = true
      speakerSpans = listOf(speakerSpan(id = 20, index = 1, duration = 3f))
    }
    val linesById = LinkedHashMap<Long, TranscriptLine>()
    val completedLineIds = mutableSetOf<Long>()

    assertEquals(
      listOf("lineCompleted"),
      MoonshineTranscriptPolicy.applyLine(original, linesById, completedLineIds)
    )
    assertEquals(
      listOf("lineUpdated"),
      MoonshineTranscriptPolicy.applyLine(revision, linesById, completedLineIds)
    )
    assertEquals(20L, MoonshineTranscriptPolicy.dominantSpeakerSpan(linesById[42]!!)?.speakerId)
  }

  @Test
  fun firstCompletionUsesCompletionEventWithoutDuplicateUpdate() {
    val line = TranscriptLine().apply {
      isComplete = true
      isUpdated = true
      haveSpeakersChanged = true
    }

    assertEquals(
      listOf("lineCompleted"),
      MoonshineTranscriptPolicy.applyLine(line, LinkedHashMap(), mutableSetOf())
    )
  }

  @Test
  fun speakerChangeUpdatesEvenWhenUpstreamDoesNotSetIsUpdated() {
    val line = TranscriptLine().apply {
      isComplete = true
      isUpdated = false
      haveSpeakersChanged = true
    }

    val linesById = linkedMapOf<Long, TranscriptLine>()
    val completedLineIds = mutableSetOf(1L)
    line.id = 1
    assertEquals(
      listOf("lineUpdated"),
      MoonshineTranscriptPolicy.applyLine(line, linesById, completedLineIds)
    )
  }

  @Test
  fun dominantSpeakerUsesLongestSpanAndKeepsFirstOnTie() {
    val first = speakerSpan(id = 10, index = 0, duration = 2f)
    val shorter = speakerSpan(id = 20, index = 1, duration = 1f)
    val tied = speakerSpan(id = 30, index = 2, duration = 2f)
    val line = TranscriptLine().apply { speakerSpans = listOf(first, shorter, tied) }

    assertEquals(first, MoonshineTranscriptPolicy.dominantSpeakerSpan(line))
    assertNull(MoonshineTranscriptPolicy.dominantSpeakerSpan(TranscriptLine()))
  }

  private fun speakerSpan(id: Long, index: Int, duration: Float): SpeakerSpan {
    return SpeakerSpan().apply {
      speakerId = id
      speakerIndex = index
      this.duration = duration
    }
  }
}

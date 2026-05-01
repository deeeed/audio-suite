package net.siteed.audiostudio

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class InterruptionAutoResumePolicyTest {
    @Test
    fun autoResumesOnlyWhenSystemInterruptionPausedRecording() {
        assertTrue(InterruptionAutoResumePolicy.shouldAutoResume(
            autoResumeAfterInterruption = true,
            isRecording = true,
            isPaused = true,
            pausedBySystemInterruption = true
        ))
    }

    @Test
    fun doesNotAutoResumeUserPausedRecording() {
        assertFalse(InterruptionAutoResumePolicy.shouldAutoResume(
            autoResumeAfterInterruption = true,
            isRecording = true,
            isPaused = true,
            pausedBySystemInterruption = false
        ))
    }

    @Test
    fun requiresAutoResumeAndActivePausedRecording() {
        assertFalse(InterruptionAutoResumePolicy.shouldAutoResume(
            autoResumeAfterInterruption = false,
            isRecording = true,
            isPaused = true,
            pausedBySystemInterruption = true
        ))
        assertFalse(InterruptionAutoResumePolicy.shouldAutoResume(
            autoResumeAfterInterruption = true,
            isRecording = false,
            isPaused = true,
            pausedBySystemInterruption = true
        ))
        assertFalse(InterruptionAutoResumePolicy.shouldAutoResume(
            autoResumeAfterInterruption = true,
            isRecording = true,
            isPaused = false,
            pausedBySystemInterruption = true
        ))
    }
}

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..', '..')

function readOptionalReference(relativePath) {
  const absolutePath = path.join(REPO_ROOT, relativePath)
  if (!fs.existsSync(absolutePath)) return null
  return fs.readFileSync(absolutePath, 'utf8').replace(/\s+/g, ' ').trim() || null
}

const asrEvalManifest = [
  {
    id: 'ami-is1001a-150-170',
    label: 'AMI meeting excerpt (150s-170s)',
    hostPath: '/tmp/ami-150-170.wav',
    deviceFileName: 'ami-150-170.wav',
    referenceTranscript:
      'So the the goal is to have a remote control, so to have an advantage over our competitors, we have to be original, we have to be trendy and we have to also try to be user-friendly. So uh the design step will be divided in three',
    transcriptSource: 'AMI reference excerpt',
    description: 'Meeting speech with hesitations and discourse markers.',
    modes: ['offline', 'simulated'],
  },
  {
    id: 'jfk-public-quote',
    label: 'JFK public quote',
    relativeHostPath: 'apps/playground/public/audio_samples/jfk.wav',
    deviceFileName: 'jfk.wav',
    referenceTranscript:
      'And so my fellow Americans ask not what your country can do for you ask what you can do for your country',
    transcriptSource: 'Known public quote',
    description: 'Clean speech sanity check on a familiar quote.',
    modes: ['offline', 'simulated'],
  },
  {
    id: 'recorder-jre-lex-watch',
    label: 'Recorder sample (22.7s)',
    relativeHostPath: 'apps/playground/public/audio_samples/recorder_jre_lex_watch.wav',
    deviceFileName: 'recorder-jre-lex-watch.wav',
    referenceTranscript: null,
    transcriptSource: 'No exact reference transcript in repo',
    description: 'Longer spoken sample for latency and stability comparison.',
    modes: ['offline', 'simulated'],
  },
  {
    id: 'osr-us-000-0010-8k',
    label: 'OSR sample (33.6s)',
    relativeHostPath: 'apps/playground/public/audio_samples/osr_us_000_0010_8k.wav',
    deviceFileName: 'osr-us-000-0010-8k.wav',
    referenceTranscript: null,
    transcriptSource: 'No exact reference transcript in repo',
    description: 'Longer narrowband speech sample for long-form performance comparison.',
    modes: ['offline', 'simulated'],
  },
  {
    id: 'recorder-hello-world',
    label: 'Hello world',
    relativeHostPath: 'apps/playground/public/audio_samples/recorder_hello_world.wav',
    deviceFileName: 'recorder-hello-world.wav',
    referenceTranscript: 'hello world',
    transcriptSource: 'Literal utterance',
    description: 'Short sanity check clip for regressions.',
    modes: ['offline', 'simulated'],
  },
  {
    id: 'perps-controller-refactor-5m-echobridge-medium',
    label: 'Perps controller refactor EchoBridge excerpt (5m)',
    relativeHostPath: '.agent/fixtures/diarization/perps_controller_refactor_5m_16k_mono.wav',
    deviceFileName: 'perps-controller-refactor-5m.wav',
    referenceTranscript: readOptionalReference(
      '.agent/validation-logs/asr/echobridge-reference/perps-5m-echobridge-whisper-medium.transcript.txt'
    ),
    transcriptSource: 'EchoBridge WhisperService medium.en backend reference',
    description:
      'Five-minute real meeting excerpt used to validate long-form Moonshine transcript quality via direct PCM replay.',
    modes: ['offline', 'simulated'],
  },
]

export default asrEvalManifest

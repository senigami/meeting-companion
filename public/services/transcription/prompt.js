export function buildTranscriptionPrompt(mode = 'speaker') {
  switch (mode) {
    case 'information':
      return 'Church meeting audio transcription. Preserve exact dates, times, places, hymn numbers, assignments, and announcements.';
    case 'song':
      return 'Church meeting audio transcription. Capture hymn or song status only.';
    case 'prayer':
      return 'Church meeting audio transcription. Capture prayer status and requests without line-by-line commentary.';
    case 'speaker':
    default:
      return 'Church meeting audio transcription. Capture the specific story, event, teaching, feeling, invitation, or example.';
  }
}

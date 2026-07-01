const DEMO_STEPS = [
  {
    delay: 0,
    mode: 'speaker',
    text: 'A long hospital visit changed the family pace for the week.'
  },
  {
    delay: 1800,
    mode: 'information',
    text: 'Tuesday, 7:00 p.m., Fellowship Hall.'
  },
  {
    delay: 3600,
    mode: 'song',
    text: 'Hymn 198, ready to sing.'
  },
  {
    delay: 5400,
    mode: 'prayer',
    text: 'Pray for the families and the travelers.'
  },
  {
    delay: 7200,
    mode: 'speaker',
    text: 'The speaker invites everyone to greet someone new after the meeting.'
  },
  {
    delay: 9000,
    mode: 'information',
    text: 'Assignments: platform 1, microphone 2.'
  }
];

export function isDemoModeEnabled(search = '') {
  try {
    return new URLSearchParams(String(search)).has('demo');
  } catch {
    return false;
  }
}

export function getDemoFeedSteps() {
  return DEMO_STEPS.map((step) => ({ ...step }));
}

export function startDemoFeed(runtime, { setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout } = {}) {
  if (!runtime?.addLine) return () => {};

  const handles = [];

  for (const step of DEMO_STEPS) {
    const handle = setTimeoutFn(() => {
      runtime.setMode?.(step.mode);
      runtime.handleTranscriptEvent?.({
        source: 'browser',
        type: 'final',
        text: step.text
      });
      runtime.addLine(step.text, { source: 'ai', mode: step.mode });
    }, step.delay);
    handles.push(handle);
  }

  return () => {
    for (const handle of handles) {
      clearTimeoutFn(handle);
    }
  };
}

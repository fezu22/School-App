module.exports = async function* deepTestReporter(source) {
  for await (const event of source) {
    if (!['test:pass', 'test:fail', 'test:summary', 'test:diagnostic', 'test:stderr'].includes(event.type)) continue;
    const value = event.data;
    yield JSON.stringify({type: event.type, name: value.name, file: value.file, line: value.line, skip: value.skip, message: value.message, counts: value.counts,
      details: value.details ? {duration_ms: value.details.duration_ms, error: value.details.error ? {message: value.details.error.message, cause: value.details.error.cause?.message, failureType: value.details.error.failureType} : undefined} : undefined,
    }) + '\n';
  }
};

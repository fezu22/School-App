module.exports = async function* securityAuditReporter(source) {
  for await (const event of source) {
    if (['test:pass', 'test:fail', 'test:summary', 'test:diagnostic'].includes(event.type)) {
      const data = event.data;
      yield JSON.stringify({type: event.type, name: data.name, file: data.file, line: data.line, skip: data.skip, message: data.message,
        details: data.details ? {duration_ms: data.details.duration_ms, error: data.details.error ? {message: data.details.error.message, failureType: data.details.error.failureType, cause: data.details.error.cause?.message} : undefined} : undefined,
        counts: data.counts,
      }) + '\n';
    }
  }
};

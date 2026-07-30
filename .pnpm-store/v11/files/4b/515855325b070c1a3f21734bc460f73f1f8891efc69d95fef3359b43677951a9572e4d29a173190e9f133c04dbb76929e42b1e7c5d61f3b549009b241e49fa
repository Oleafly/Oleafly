// src/test/convert-array-to-async-iterable.ts
function convertArrayToAsyncIterable(values) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const value of values) {
        yield value;
      }
    }
  };
}

// src/test/convert-array-to-readable-stream.ts
function convertArrayToReadableStream(values) {
  return new ReadableStream({
    start(controller) {
      try {
        for (const value of values) {
          controller.enqueue(value);
        }
      } finally {
        controller.close();
      }
    }
  });
}

// src/test/convert-async-iterable-to-array.ts
async function convertAsyncIterableToArray(iterable) {
  const result = [];
  for await (const item of iterable) {
    result.push(item);
  }
  return result;
}

// src/test/convert-readable-stream-to-array.ts
async function convertReadableStreamToArray(stream) {
  const reader = stream.getReader();
  const result = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result.push(value);
  }
  return result;
}

// src/test/convert-response-stream-to-array.ts
async function convertResponseStreamToArray(response) {
  return await convertReadableStreamToArray(
    response.body.pipeThrough(new TextDecoderStream())
  );
}

// src/test/is-node-version.ts
function getNodeVersionParts() {
  return process.versions.node.split(".").map((version) => Number.parseInt(version, 10));
}
function isNodeVersion(version) {
  const [nodeMajorVersion] = getNodeVersionParts();
  return nodeMajorVersion === version;
}
function isNodeVersionAtLeast(major, minor = 0, patch = 0) {
  const [nodeMajorVersion, nodeMinorVersion, nodePatchVersion] = getNodeVersionParts();
  if (nodeMajorVersion !== major) {
    return nodeMajorVersion > major;
  }
  if (nodeMinorVersion !== minor) {
    return nodeMinorVersion > minor;
  }
  return nodePatchVersion >= patch;
}

// src/test/mock-id.ts
function mockId({
  prefix = "id"
} = {}) {
  let counter = 0;
  return () => `${prefix}-${counter++}`;
}
export {
  convertArrayToAsyncIterable,
  convertArrayToReadableStream,
  convertAsyncIterableToArray,
  convertReadableStreamToArray,
  convertResponseStreamToArray,
  isNodeVersion,
  isNodeVersionAtLeast,
  mockId
};
//# sourceMappingURL=index.js.map
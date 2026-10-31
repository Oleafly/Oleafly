import { expect, it, vi } from "vitest";
import { flushPersonalComments, registerPersonalCommentsFlush } from "./personal-comments-flush";

it("waits for durable notes and propagates save failures to quit/update guards", async () => {
  const flush = vi.fn().mockRejectedValueOnce(new Error("disk full")).mockResolvedValue(undefined);
  const release = registerPersonalCommentsFlush(flush);
  try {
    await expect(flushPersonalComments()).rejects.toThrow("disk full");
    await flushPersonalComments();
    expect(flush).toHaveBeenCalledTimes(2);
  } finally {
    release();
  }
  await flushPersonalComments();
  expect(flush).toHaveBeenCalledTimes(2);
});

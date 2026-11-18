import { CommentComposer as KitComposer, type CommentComposerProps } from "@/components/ui/comments/comment-composer";
import { peerHue } from "../live/peer-hue";
import { useCommentComposerLabels } from "./desktop-comment-kit";
import { commentFailure, commentRetryable } from "./refusals";

export function CommentComposer(props: Readonly<Omit<CommentComposerProps, "labels" | "describeError" | "canRetry" | "hue">>) {
  const labels = useCommentComposerLabels();
  return (
    <KitComposer
      {...props}
      labels={labels}
      describeError={commentFailure}
      canRetry={commentRetryable}
      hue={(id) => peerHue(id, props.self)}
    />
  );
}

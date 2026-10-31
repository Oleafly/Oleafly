import { Contained } from "@/components/Contained";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { i18n } from "@/i18n";
import { useConfirmDialogStore } from "@/store/confirm-dialog";

function cancelOldestRequest() {
  useConfirmDialogStore.getState().queue[0]?.settle(false);
}

/** Shows the oldest question `confirmAction` is waiting on. */
export function ConfirmHost() {
  const requestId = useConfirmDialogStore((state) => state.queue[0]?.id);
  return (
    <Contained resetKey={requestId} close={cancelOldestRequest}>
      <OldestRequest />
    </Contained>
  );
}

function OldestRequest() {
  const request = useConfirmDialogStore((state) => state.queue[0]);
  if (!request) return null;
  const label = request.confirmLabel ?? i18n.t(($) => $.common.actions.confirm);
  return (
    <ConfirmationDialog
      key={request.id}
      open
      title={label}
      description={request.message}
      confirmLabel={label}
      destructive={request.destructive}
      onConfirm={() => request.settle(true)}
      onCancel={() => request.settle(false)}
    />
  );
}

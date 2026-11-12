import { NoteChip } from "./note-icons";

export default function NoteTabIcon({ icon, color }: Readonly<{ icon?: string; color?: string }>) {
  return <NoteChip icon={icon} color={color} size="xs" />;
}

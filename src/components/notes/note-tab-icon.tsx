import { NoteChip } from "./note-icons";

export default function NoteTabIcon({ icon, color }: Readonly<{ icon?: string; color?: string }>) {
  return <NoteChip icon={icon} color={color} className="size-4 rounded [&_svg]:size-3 [&>span]:text-[0.625rem]" />;
}

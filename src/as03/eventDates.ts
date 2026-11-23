const months = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

export function formatDate(value: string): string | undefined {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const month = parts && months[Number(parts[2]) - 1];
  if (parts && month) return `${Number(parts[3])} ${month} ${parts[1]}`;
}

export function formatStart(value: string): string | undefined {
  const parts = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value);
  const date = parts && formatDate(parts[1]);
  if (parts && date) return `${date}, ${parts[2]} MYT`;
}

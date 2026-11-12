export function normalizeCategoryName(input: string): {
  name: string;
  nameKey: string;
} {
  const name = input.trim();
  return {
    name,
    nameKey: name.replace(/[A-Z]/g, (letter) => letter.toLowerCase()),
  };
}

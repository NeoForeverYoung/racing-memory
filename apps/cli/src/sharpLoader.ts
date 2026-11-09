export async function loadSharp(): Promise<typeof import("sharp").default> {
  const module = await import("sharp");
  return module.default;
}

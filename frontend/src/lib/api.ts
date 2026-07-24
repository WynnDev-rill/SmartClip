export type Health = { status: string; service: string };
const API_URL = import.meta.env.VITE_API_URL ?? "/api";
export async function getHealth(): Promise<Health> { const response=await fetch(`${API_URL}/health`); if(!response.ok) throw new Error("Health check failed"); return response.json() as Promise<Health>; }

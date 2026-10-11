import type { ErrorComponentProps } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";

const FALLBACK_MESSAGE = "An unexpected error occurred. Try reloading the page.";

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return FALLBACK_MESSAGE;
}

export function AppErrorComponent({ error }: ErrorComponentProps) {
  return (
    <main
      className={
        "nest flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center " +
        "bg-night text-ivory"
      }
    >
      <img src="/brand/al3sh-mark.svg" alt="" className="h-24 w-auto" />
      <span className="grid size-12 place-items-center rounded-full border border-wrong/50 bg-wrong-fill/15 text-wrong" aria-hidden="true">
        <TriangleAlert className="size-6" strokeWidth={2} />
      </span>
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="max-w-md text-sm break-words text-mist">
        {errorMessage(error)}
      </p>
    </main>
  );
}

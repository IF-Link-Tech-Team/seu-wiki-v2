import { redirect } from "react-router";
import type { Route } from "./+types/handbook.v2.$id";

export function loader({ params }: Route.LoaderArgs) {
  throw redirect(`/handbook#guide-${encodeURIComponent(params.id ?? "")}`, 301);
}

import { redirect } from "next/navigation";

export default function TickerDefaultPage() {
  redirect("/ticker/AAPL");
}

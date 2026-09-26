import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div className="behallare sektion stack-5">
      <h1 className="t-rubrik-1">Sidan finns inte</h1>
      <p className="t-ingress">Adressen kan vara felstavad eller så har sidan flyttats.</p>
      <p><Link className="mid-knapp mid-knapp-kontur" to="/">Till startsidan</Link></p>
    </div>
  );
}

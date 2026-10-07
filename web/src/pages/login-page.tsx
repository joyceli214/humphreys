import { FormEvent, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth/auth-context";
import { useAlerts } from "@/lib/alerts/alert-context";

export default function LoginPage() {
  const { login } = useAuth();
  const alerts = useAlerts();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget as HTMLFormElement);
    const emailValue = String(form.get("email") ?? email).trim();
    const passwordValue = String(form.get("password") ?? password);
    setSubmitting(true);
    try {
      await login(emailValue, passwordValue);
      alerts.success("Signed in", "Welcome back.");
    } catch (err) {
      alerts.error("Login failed", err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center bg-[conic-gradient(from_120deg_at_50%_50%,#fff7ed_0%,#ffedd5_40%,#f8fafc_100%)] p-4">
      <form onSubmit={onSubmit} method="post" autoComplete="on" className="w-full max-w-md bg-white border border-border rounded-xl p-6 space-y-4 shadow-lg">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Admin Access</p>
          <h1 className="text-2xl font-bold">Sign in</h1>
        </div>
        <div>
          <label htmlFor="email" className="mb-1 block text-sm">Email</label>
          <Input id="email" name="email" type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-sm">Password</label>
          <div className="relative">
            <Input id="password" name="password" autoComplete="current-password" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} required className="pr-10" />
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              title={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        <Button className="w-full" type="submit" disabled={submitting}>
          {submitting ? "Signing in..." : "Sign in"}
        </Button>
      </form>
    </div>
  );
}

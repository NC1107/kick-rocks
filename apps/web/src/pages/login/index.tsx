import { type FormEvent, useEffect, useRef, useState } from "react";
import { ApiRequestError, errorMessage, useLogin } from "../../api/index.js";
import { Alert, Button, Card, CardHeader, Field, Input } from "../../components/ui/index.js";
import { usePageTitle } from "../../lib/use-page-title.js";

export function Component() {
  usePageTitle("Sign in");
  const login = useLogin();
  const [password, setPassword] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (password) login.mutate({ body: { password } });
  };

  const failure = login.error;
  const wrongPassword = failure instanceof ApiRequestError && failure.status === 401;

  return (
    <Card>
      <CardHeader title="Sign in" description="Enter the password for this Kick Rocks instance." />
      <form onSubmit={submit} className="flex flex-col gap-4">
        {/* Gives password managers an account name to save the password under. */}
        <input
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          autoComplete="username"
          name="username"
          defaultValue="kickrocks"
          readOnly
        />
        <Field label="Password" error={wrongPassword ? failure.message : undefined}>
          <Input
            ref={input}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        {failure && !wrongPassword ? <Alert intent="danger">{errorMessage(failure)}</Alert> : null}
        <Button type="submit" variant="primary" loading={login.isPending} className="w-full">
          Sign in
        </Button>
      </form>
    </Card>
  );
}

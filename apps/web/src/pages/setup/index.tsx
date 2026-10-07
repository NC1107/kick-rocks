import { MIN_PASSWORD_LENGTH, Password } from "@kickrocks/shared";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { ApiRequestError, errorMessage, useSetup } from "../../api/index.js";
import { Alert, Button, Card, CardHeader, Field, Input } from "../../components/ui/index.js";
import { usePageTitle } from "../../lib/use-page-title.js";
import { PasswordInput } from "../login/password-input.js";

export function Component() {
  usePageTitle("Set a password");
  const setup = useSetup();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<{ password?: string; confirm?: string }>({});

  useEffect(() => input.current?.focus(), []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const checked = Password.safeParse(password);
    if (!checked.success) {
      setProblem({ password: `Use at least ${MIN_PASSWORD_LENGTH} characters.` });
      return;
    }
    if (password !== confirm) {
      setProblem({ confirm: "The two passwords do not match." });
      return;
    }
    setProblem({});
    setup.mutate({ body: { password } });
  };

  const failure = setup.error;
  const fieldIssue = failure instanceof ApiRequestError ? failure.fieldErrors.password : undefined;

  return (
    <Card>
      <CardHeader
        title="Set a password"
        description="This password protects everything Kick Rocks stores about you. You will use it each time you sign in."
      />
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
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
        <Field
          label="Password"
          help={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          error={problem.password ?? fieldIssue}
        >
          <PasswordInput
            ref={input}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <Field label="Confirm password" error={problem.confirm}>
          <Input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </Field>
        {failure && !fieldIssue ? <Alert intent="danger">{errorMessage(failure)}</Alert> : null}
        <Button type="submit" variant="primary" loading={setup.isPending} className="w-full">
          Set password
        </Button>
      </form>
    </Card>
  );
}

import { Eye, EyeOff } from "lucide-react";
import { type ComponentProps, useState } from "react";
import { IconButton, Input } from "../../components/ui/index.js";

/** A password field with a control to reveal what was typed, for checking a new password. */
export function PasswordInput(props: Omit<ComponentProps<typeof Input>, "type" | "trailing">) {
  const [shown, setShown] = useState(false);
  return (
    <Input
      {...props}
      type={shown ? "text" : "password"}
      trailing={
        <IconButton
          label={shown ? "Hide password" : "Show password"}
          size="sm"
          aria-pressed={shown}
          onClick={() => setShown((value) => !value)}
          className="size-7 max-sm:size-11 pointer-coarse:size-11"
        >
          {shown ? <EyeOff /> : <Eye />}
        </IconButton>
      }
    />
  );
}

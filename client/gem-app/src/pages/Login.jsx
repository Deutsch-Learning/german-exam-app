import { useState } from "react";
import API from "../services/api";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleLogin = async () => {
    try {
      const res = await API.post("/login", { email, password });
      console.log(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div style={{padding:"20px"}}>
      <h2>Login</h2>
      <input onChange={(e) => setEmail(e.target.value)} placeholder="Email" /><br /><br />
      <input onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Password" /><br /><br />
      <button onClick={handleLogin}>Login</button>
    </div>
  );
}


import { Route, Routes } from "react-router-dom";
import HomePage from "./pages/HomePage";
import JoinPage from "./pages/JoinPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/dm/:token" element={<JoinPage />} />
      <Route path="/j/:token" element={<JoinPage />} />
    </Routes>
  );
}

import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

const NotFound = () => {
  const { t } = useTranslation();
  const location = useLocation();

  // 404 logged only in development
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.warn("404: non-existent route:", location.pathname);
    }
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted safe-area-inset">
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-xl text-muted-foreground">{t("notFound.title")}</p>
        <a href="/" className="text-primary underline hover:text-primary/90">
          {t("notFound.home")}
        </a>
      </div>
    </div>
  );
};

export default NotFound;

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FINDER_MENUS: Record<string, { services: string; quickActions: string; customize: string }> = {
  cs: { services: "Služby", quickActions: "Rychlé akce", customize: "Vlastní" },
  da: { services: "Tjenester", quickActions: "Hurtige kommandoer", customize: "Tilpas" },
  de: { services: "Dienste", quickActions: "Schnellaktionen", customize: "Anpassen" },
  en: { services: "Services", quickActions: "Quick Actions", customize: "Customize" },
  es: { services: "Servicios", quickActions: "Acciones rápidas", customize: "Personalizar" },
  fi: { services: "Palvelut", quickActions: "Pikatoiminnot", customize: "Muokkaa" },
  fr: { services: "Services", quickActions: "Actions rapides", customize: "Personnaliser" },
  it: { services: "Servizi", quickActions: "Azioni rapide", customize: "Personalizza" },
  ja: { services: "サービス", quickActions: "クイックアクション", customize: "カスタマイズ" },
  ko: { services: "서비스", quickActions: "빠른 동작", customize: "사용자화" },
  nb: { services: "Tjenester", quickActions: "Hurtighandlinger", customize: "Tilpass" },
  nl: { services: "Voorzieningen", quickActions: "Snelle taken", customize: "Pas aan" },
  pl: { services: "Usługi", quickActions: "Szybkie czynności", customize: "Dostosuj" },
  "pt-BR": { services: "Serviços", quickActions: "Ações Rápidas", customize: "Personalizar" },
  ro: { services: "Servicii", quickActions: "Acțiuni rapide", customize: "Personalizare" },
  ru: { services: "Службы", quickActions: "Быстрые действия", customize: "Настроить" },
  sv: { services: "Tjänster", quickActions: "Snabbåtgärder", customize: "Anpassa" },
  tr: { services: "Servisler", quickActions: "Hızlı Eylemler", customize: "Özelleştir" },
  uk: { services: "Служби", quickActions: "Швидкі дії", customize: "Налаштувати" },
  "zh-Hans": { services: "服务", quickActions: "快速操作", customize: "自定义" },
  "zh-Hant": { services: "服務", quickActions: "快速動作", customize: "自訂" },
};

const localesDir = fileURLToPath(new URL("./locales/", import.meta.url));

function catalog(locale: string, namespace: string) {
  return JSON.parse(readFileSync(`${localesDir}${locale}/${namespace}.json`, "utf8"));
}

describe("Finder menu names in the Quick Action copy", () => {
  it("covers every shipped locale", () => {
    expect(Object.keys(FINDER_MENUS).sort()).toEqual(readdirSync(localesDir).sort());
  });

  it.each(Object.entries(FINDER_MENUS))(
    "uses the names macOS shows for %s",
    (locale, { services, quickActions, customize }) => {
      const quickAction = catalog(locale, "settings").systemIntegration.quickAction;
      const offer = catalog(locale, "shell").quickActionOffer;
      const menuPath = new RegExp(`${quickActions}\\S*\\s?›\\s?\\S?${customize}(?!\\s?(?:[\\u2026\\u22ef]|\\.{3}))`);

      expect(quickAction.label).toContain(quickActions);
      expect(quickAction.description).toContain(services);
      expect(quickAction.description).not.toContain(quickActions);
      expect(quickAction.description).not.toContain(customize);
      expect(quickAction.menuHint).toMatch(menuPath);
      expect(quickAction.menuHint).toContain("{{title}}");
      expect(offer.body).toContain(services);
      expect(offer.body).toContain(quickActions);
      expect(offer.body).not.toContain(customize);
      expect(offer.added).toContain(services);
      expect(offer.added).toMatch(menuPath);
      expect(offer.addedInQuickActions).toContain(quickActions);
      expect(offer.addedInQuickActions).not.toContain(customize);
      for (const text of [
        quickAction.label,
        quickAction.description,
        quickAction.menuHint,
        offer.body,
        offer.added,
        offer.addedInQuickActions,
      ]) {
        expect(text).not.toMatch(/[\u2013\u2014]/);
      }
    },
  );
});

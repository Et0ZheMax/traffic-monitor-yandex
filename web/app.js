"use strict";
const byId = (id) => document.getElementById(id);
let apiReady, map, multiRoute, measuredAt;
function point(value) {
  const parts = value.trim().split(/[,;\s]+/);
  const numbers = parts.map(Number);
  if (parts.length !== 2 || numbers.some((n) => !Number.isFinite(n)) ||
      Math.abs(numbers[0]) > 90 || Math.abs(numbers[1]) > 180) {
    throw new Error("Введите две координаты: широта, долгота.");
  }
  return numbers;
}
function loadApi(key) {
  if (apiReady) return apiReady;
  apiReady = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timeout = setTimeout(() => reject(new Error("Загрузка API заняла слишком много времени. Перезагрузите страницу.")), 20000);
    script.src = "https://api-maps.yandex.ru/2.1/?lang=ru_RU&load=package.full&apikey=" + encodeURIComponent(key);
    script.onload = () => {
      if (!window.ymaps) { clearTimeout(timeout); reject(new Error("API не загрузился. Проверьте ключ и доступ.")); return; }
      window.ymaps.ready(() => { clearTimeout(timeout); resolve(); });
    };
    script.onerror = () => { clearTimeout(timeout); reject(new Error("API недоступен. Проверьте сеть, ключ и домен сайта.")); };
    document.head.append(script);
  });
  return apiReady;
}
function routeFailureMessage(event) {
  // Never render the raw provider error: it can contain request URLs or keys.
  const message = String(event.get("error")?.message ?? "");
  if (/key|referer|forbidden|403|invalid/i.test(message)) {
    return "Яндекс отклонил ключ или домен сайта. Если настройки только сохранены, подождите до 15 минут и перезагрузите страницу перед повторной проверкой.";
  }
  const safeMessage = message
    .replace(/https?:\/\/\S+/gi, "[URL скрыт]")
    .replace(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi, "[идентификатор скрыт]")
    .replace(/(?:api[-_]?key|token|secret)\s*[:=]\s*[^\s&,;]+/gi, "[секрет скрыт]")
    .replace(/[\r\n]+/g, " ").slice(0, 240);
  return "Маршрут не получен. Проверьте доступ к маршрутизации, активацию ключа и ограничения домена." +
    (safeMessage ? " Ошибка маршрутизатора: " + safeMessage : "");
}
function renderRoutes(routeObject) {
  if (routeObject !== multiRoute) return;
  byId("routes").replaceChildren();
  const table = document.createElement("table");
  const header = table.createTHead().insertRow();
  ["Вариант", "С пробками", "Расстояние", "Перекрытия"].forEach((label) => {
    const cell = document.createElement("th"); cell.scope = "col"; cell.textContent = label; header.append(cell);
  });
  let count = 0;
  routeObject.getRoutes().each((route) => {
    const row = table.insertRow();
    const traffic = route.properties.get("durationInTraffic");
    const distance = route.properties.get("distance");
    const blocked = route.properties.get("blocked");
    [++count, traffic?.text ?? "нет данных", distance?.text ?? "нет данных",
      blocked === true ? "есть" : blocked === false ? "не указаны" : "нет данных"]
      .forEach((value) => { row.insertCell().textContent = String(value); });
  });
  if (count) byId("routes").append(table);
  byId("status").textContent = count ?
    `Получено вариантов: ${count}. Обновлено ${new Date(measuredAt).toLocaleString("ru-RU", {timeZone:"Europe/Moscow"})} МСК.` :
    "Яндекс не вернул доступных маршрутов.";
}
byId("route-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const origin = point(byId("origin").value), destination = point(byId("destination").value);
    const key = byId("api-key").value.trim();
    if (!key && !apiReady) throw new Error("Введите ключ JavaScript API.");
    byId("build").disabled = true;
    byId("status").textContent = "Загрузка маршрута…";
    byId("routes").replaceChildren(); measuredAt = null;
    await loadApi(key);
    byId("api-key").value = ""; byId("api-key").required = false;
    if (!map) map = new ymaps.Map("map", {center: origin, zoom: 11, controls: ["zoomControl", "trafficControl"]});
    if (multiRoute) {
      map.geoObjects.remove(multiRoute);
      multiRoute.model.destroy();
    }
    const current = new ymaps.multiRouter.MultiRoute({
      referencePoints: [origin, destination], params: {routingMode:"auto", avoidTrafficJams:true}
    }, {boundsAutoApply:true});
    multiRoute = current;
    current.model.events.add("requestsuccess", () => {
      if (current !== multiRoute) return;
      measuredAt = Date.now(); renderRoutes(current); byId("build").disabled = false;
    });
    current.model.events.add("requestfail", (event) => {
      if (current !== multiRoute) return;
      measuredAt = null; byId("routes").replaceChildren();
      byId("status").textContent = routeFailureMessage(event);
      byId("build").disabled = false;
    });
    map.geoObjects.add(current);
  } catch (error) {
    byId("status").textContent = error.message; byId("build").disabled = false;
  }
});
byId("swap").addEventListener("click", () => {
  [byId("origin").value, byId("destination").value] = [byId("destination").value, byId("origin").value];
});
byId("copy-link").addEventListener("click", async () => {
  try {
    const origin = point(byId("origin").value), destination = point(byId("destination").value);
    const url = new URL("https://yandex.ru/maps/");
    url.searchParams.set("rtext", origin.join(",") + "~" + destination.join(","));
    url.searchParams.set("rtt", "auto");
    await navigator.clipboard.writeText(url.href);
    byId("status").textContent = "Скопирована ссылка с вашими точками. Данные API не экспортировались.";
  } catch { byId("status").textContent = "Не удалось скопировать ссылку. Проверьте координаты и разрешение буфера обмена."; }
});
setInterval(() => {
  if (measuredAt && Date.now() - measuredAt > 20 * 60000) {
    measuredAt = null; byId("routes").replaceChildren();
    byId("status").textContent = "Данные старше 20 минут. Постройте маршрут заново для обновления.";
  }
}, 15000);

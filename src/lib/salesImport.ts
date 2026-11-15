import type { NewClientInput } from '@/types';

/** Клиент, извлечённый из отчёта о продажах. */
export type ImportedClient = NewClientInput;

/** Код клиента в отчёте: «06031», «Б2902» и т. п. */
const CODE_PATTERN = /^[A-Za-zА-Яа-я]?\d{3,6}$/;

/** Организационно-правовая форма, которая идёт после имени клиента. */
const FORM_PATTERN = /^(ИП|ООО|ОАО|ЗАО|АО|ПАО)$/i;

/** Префикс города в полном адресе: «г. Ухта», «с. Усть-Цильма», «пгт ...». */
const CITY_PREFIX_PATTERN =
    /^(?:г\.|город\s+|пгт\.?\s+|пос\.?\s+|посёлок\s+|с\.|село\s+|дер\.?\s+|деревня\s+|рп\.?\s+|рабочий посёлок\s+)/i;

/** Части адреса, которые являются улицей, а не городом. */
const STREET_PREFIX_PATTERN =
    /^(?:ул\.|улица\s+|пр\.|пр-д|пр-т|проезд\s+|наб\.|набережная\s+|пер\.|переулок\s+|мкр\.?|микрорайон\s+|д\.|дом\s+)/i;

/** Регион и почтовый индекс — в адрес клиента не попадают. */
const REGION_PATTERN = /^(?:республика|респ\.?|обл\.?|область|край|район|р-н)(?:\s|$)/i;

/** Название магазина/павильона — не часть улицы. */
const STORE_PATTERN = /^(?:магазин|маг\.?|м-н|зоомагазин|тц|тк|торговый|павильон|пав\.?)(?:\s|$|№)/i;

function cleanSpaces(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

/** Сокращённые названия городов из префикса строки. */
function normalizeCity(value: string): string {
    const trimmed = value.replace(/[.,;:]+$/g, '').trim();
    const lower = trimmed.toLowerCase();
    if (lower.startsWith('сосн')) return 'Сосногорск';
    if (lower.startsWith('сыкт')) return 'Сыктывкар';
    if (lower === 'рк' || lower === 'коми') return '';
    return trimmed;
}

/**
 * Разбирает полный адрес из скобок.
 * Поддерживает человекочитаемый формат
 * «Республика Коми, г. Сосногорск, 6-й мкр., д. 28, кор. б, магазин "Котопес"»
 * и выгрузку 1С «,169300,Республика Коми,,г.Ухта,,ул.Тиманская; д.11; оф.4,,,».
 */
function parseFullAddress(value: string): { city?: string; street?: string } {
    const raw = cleanSpaces(value);
    if (!raw) return {};

    const parts = raw
        .split(',')
        .map((part) => cleanSpaces(part))
        .filter(Boolean);
    if (parts.length === 0) return {};

    let cityIndex = -1;
    for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index];
        if (STREET_PREFIX_PATTERN.test(part)) continue;
        if (CITY_PREFIX_PATTERN.test(part)) {
            cityIndex = index;
            break;
        }
    }

    if (cityIndex >= 0) {
        const city = cleanSpaces(
            parts[cityIndex].replace(CITY_PREFIX_PATTERN, '').replace(/[.;,]+$/g, ''),
        );
        const street = parts
            .slice(cityIndex + 1)
            .filter((part) => !STORE_PATTERN.test(part))
            .map((part) => cleanSpaces(part.replace(/;+/g, ',')))
            .filter(Boolean)
            .join(', ');
        return { city: city || undefined, street: street || undefined };
    }

    const meaningful = parts.filter(
        (part) => !REGION_PATTERN.test(part) && !/^\d{6}$/.test(part) && !STORE_PATTERN.test(part),
    );
    if (meaningful.length === 0) return {};
    if (meaningful.length === 1) return { city: meaningful[0] };

    return { city: meaningful[0], street: meaningful.slice(1).join(', ') };
}

/**
 * Извлекает название магазина из полного адреса.
 * Возвращает только название без адреса и кавычек:
 * «магазин "Котопес"» → «Котопес», «магазин № 16» → undefined.
 */
function extractStoreName(value: string): string | undefined {
    const raw = cleanSpaces(value);
    if (!raw) return undefined;

    const quoted = raw.match(/["«“][^"»”]+["»”]/g) ?? [];
    for (const item of quoted) {
        const inner = item.slice(1, -1).trim();
        const name = inner.replace(/[^A-Za-zА-Яа-яЁё0-9\s-]/g, '').trim();
        if (name) return name;
    }

    const match = raw.match(
        /(?:магазин|зоомагазин|м-н|маг\.?|павильон|пав\.?|тц|тк)\s+([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9\s-]*)/i,
    );
    if (!match) return undefined;
    const name = match[1].replace(/[^A-Za-zА-Яа-яЁё0-9\s-]/g, '').trim();
    return name || undefined;
}

/**
 * Разбирает одну строку отчёта с данными клиента.
 * Пример: «06031 Бабкина Юлия Витальевна ИП Сосногорск 6й мкр 28б(...)».
 */
export function parseClientLine(raw: string): ImportedClient | null {
    const line = cleanSpaces(raw);
    if (!line) return null;

    const openIndex = line.indexOf('(');
    const closeIndex = line.lastIndexOf(')');
    const hasAddress = openIndex > 0 && closeIndex > openIndex;
    const prefix = hasAddress ? line.slice(0, openIndex).trim() : line;
    const fullAddress = hasAddress ? line.slice(openIndex + 1, closeIndex).trim() : '';

    const tokens = prefix.split(' ').filter(Boolean);
    if (tokens.length < 2) return null;

    const codeToken = tokens[0].replace(/[.,;:]+$/g, '');
    if (!CODE_PATTERN.test(codeToken)) return null;

    const formIndex = tokens.findIndex(
        (token, index) => index > 0 && FORM_PATTERN.test(token.replace(/[.,;:]+$/g, '')),
    );

    const nameTokens = formIndex > 0 ? tokens.slice(1, formIndex) : tokens.slice(1);
    const name = cleanSpaces(nameTokens.join(' '));
    if (!name) return null;

    const company = formIndex > 0 ? tokens[formIndex].replace(/[.,;:]+$/g, '').toUpperCase() : undefined;
    const rest = formIndex > 0 ? tokens.slice(formIndex + 1) : [];
    const prefixCity = rest.length > 0 ? normalizeCity(rest[0]) : '';
    const prefixStreet = rest.length > 1 ? cleanSpaces(rest.slice(1).join(' ')) : '';

    const parsedAddress = parseFullAddress(fullAddress);
    const city = parsedAddress.city || prefixCity || undefined;
    const street = parsedAddress.street || prefixStreet || undefined;
    const address = [city, street].filter(Boolean).join(', ') || undefined;

    return {
        clientCode: codeToken.toUpperCase(),
        name,
        company,
        city,
        street,
        address,
        // В «Название» попадает только название магазина, например «Котопес».
        title: extractStoreName(fullAddress),
        email: '',
        active: true,
    };
}

/** Читает все листы Excel-файла и возвращает уникальных клиентов. */
export async function parseSalesWorkbook(data: ArrayBuffer): Promise<ImportedClient[]> {
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(data, { type: 'array' });

    const clients: ImportedClient[] = [];
    const seen = new Set<string>();

    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;
        const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
            header: 1,
            raw: false,
            defval: '',
            blankrows: false,
        });

        for (const row of rows) {
            const first = Array.isArray(row) ? row[0] : undefined;
            if (typeof first !== 'string') continue;
            const parsed = parseClientLine(first);
            if (!parsed) continue;

            const code = normalizeClientCode(parsed.clientCode);
            const key = code ? `code:${code}` : `name:${normalizeText(parsed.name)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            clients.push(parsed);
        }
    }

    return clients;
}

/** Код клиента без пробелов, в верхнем регистре. */
export function normalizeClientCode(value?: string): string {
    return (value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '');
}

function normalizeText(value?: string): string {
    return (value ?? '')
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/[^a-zа-я0-9]+/gi, ' ')
        .trim();
}

function nameAddressKey(client: { name: string; address?: string }): string {
    return `name:${normalizeText(client.name)}|${normalizeText(client.address)}`;
}

/** Минимальные данные существующего клиента, нужные для поиска совпадений. */
export interface ExistingClientRef {
    id: string;
    clientCode?: string;
    name: string;
    address?: string;
}

export type ClientIndex = Map<string, ExistingClientRef>;

/** Индекс существующих клиентов: по коду и по имени+адресу. */
export function buildClientIndex(clients: ExistingClientRef[]): ClientIndex {
    const index: ClientIndex = new Map();
    for (const client of clients) {
        const code = normalizeClientCode(client.clientCode);
        if (code) index.set(`code:${code}`, client);
        index.set(nameAddressKey(client), client);
    }
    return index;
}

/** Находит существующего клиента по коду или по имени и адресу. */
export function findExistingClient(
    client: { clientCode?: string; name: string; address?: string },
    index: ClientIndex,
): ExistingClientRef | undefined {
    const code = normalizeClientCode(client.clientCode);
    if (code) {
        const byCode = index.get(`code:${code}`);
        if (byCode) return byCode;
    }
    return index.get(nameAddressKey(client));
}

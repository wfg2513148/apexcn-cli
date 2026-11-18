import { isLosslessNumber, splitNumber } from "lossless-json";
import { isRecord } from "../output.js";

type RecordValue = Record<string, unknown>;

const maximumUserId = 9999999999999999999999999999n;
export const ADMIN_V2_FORBIDDEN_FIELDS = [
  "keyword", "keywords", "apikey", "apikeys", "authorization", "ip", "ipaddress", "useragent", "requestbody", "rawbody",
  "email", "emailaddress", "phone", "phonenumber", "password", "token", "accesstoken", "refreshtoken", "cookie", "setcookie",
  "searchkeyword", "searchkeywords", "xforwardedfor", "apikeyvalue"
];

function integerCount(value: unknown): bigint | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (!isLosslessNumber(value)) return undefined;
  const { sign, digits, exponent } = splitNumber(value.value);
  if (sign || exponent < digits.length - 1 || exponent > 37) return undefined;
  return BigInt(digits + "0".repeat(exponent - digits.length + 1));
}

function userId(value: unknown): bigint | undefined {
  const integer = integerCount(value);
  return integer !== undefined && integer > 0n && integer <= maximumUserId ? integer : undefined;
}

function hasKeys(value: RecordValue, required: string[]): boolean {
  return required.every((key) => Object.hasOwn(value, key));
}

function hasForbiddenField(value: unknown): boolean {
  // This checks known contract field names; it is not a general secret scanner.
  if (Array.isArray(value)) return value.some(hasForbiddenField);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, item]) =>
    ADMIN_V2_FORBIDDEN_FIELDS.includes(key.replace(/[A-Z]/g, (letter) => letter.toLowerCase()).replace(/[-_\s]/g, "")) || hasForbiddenField(item));
}

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function rate(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100);
}

function finiteNumber(value: unknown): boolean {
  return (typeof value === "number" && Number.isFinite(value))
    || (isLosslessNumber(value) && Number.isFinite(Number(value.value)));
}

function timestamp(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== "string") return false;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/i.exec(value);
  return Boolean(match && date(match[1]) && Number(match[2]) <= 23 && Number(match[3]) <= 59
    && Number(match[4]) <= 59 && (match[6] === undefined || (Number(match[6]) <= 23 && Number(match[7]) <= 59))
    && Number.isFinite(Date.parse(value)));
}

function expectedRate(numerator: bigint, denominator: bigint): number | null {
  if (denominator === 0n) return null;
  const scaled = numerator * 20_000n;
  const roundedHundredths = (scaled + denominator) / (2n * denominator);
  return Number(roundedHundredths) / 100;
}

function date(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function counts(value: RecordValue): boolean {
  const calls = integerCount(value.calls);
  const success = integerCount(value.successCount);
  const failure = integerCount(value.failureCount);
  const unclassified = integerCount(value.unclassifiedCalls);
  return calls !== undefined && success !== undefined && failure !== undefined && unclassified !== undefined
    && calls === success + failure + unclassified;
}

const countKeys = ["calls", "successCount", "failureCount", "unclassifiedCalls"];

export function isAdminOperationsV2Response(value: unknown): boolean {
  if (!isRecord(value) || hasForbiddenField(value) || !hasKeys(value, ["kind", "schemaVersion", "semanticsId", "requestId", "window", "filter", "totals", "daily", "operations", "errors"])
    || value.kind !== "admin-operations" || value.schemaVersion !== 2 || value.semanticsId !== "AFA-CLI-OPS-1.0"
    || typeof value.requestId !== "string" || !value.requestId.startsWith("req_")) return false;
  const { window, filter, totals, daily, operations, errors } = value;
  if (!isRecord(window) || !hasKeys(window, ["from", "to", "days", "timeZone"])
    || !date(window.from) || !date(window.to) || !count(window.days) || window.days < 1 || window.days > 90
    || window.timeZone !== "Asia/Shanghai") return false;
  const start = Date.parse(`${window.from}T00:00:00Z`);
  if (Date.parse(`${window.to}T00:00:00Z`) !== start + (window.days - 1) * 86_400_000) return false;
  if (!isRecord(filter) || !hasKeys(filter, ["client", "limit"])
    || filter.client !== "apexcn-cli" || ![10, 20, 50, 100].includes(filter.limit as number)) return false;
  if (filter.user !== undefined && (!isRecord(filter.user) || !hasKeys(filter.user, ["id", "nickname"])
    || userId(filter.user.id) === undefined || !(filter.user.nickname === null || typeof filter.user.nickname === "string"))) return false;
  if (!isRecord(totals) || !hasKeys(totals, [...countKeys, "classifiedCalls", "distinctUsers", "successRate", "classificationCoverage", "freshnessAt"])
    || !counts(totals) || integerCount(totals.classifiedCalls) === undefined
    || integerCount(totals.classifiedCalls) !== integerCount(totals.successCount)! + integerCount(totals.failureCount)!
    || integerCount(totals.distinctUsers) === undefined || integerCount(totals.distinctUsers)! > integerCount(totals.calls)!
    || !rate(totals.successRate) || !rate(totals.classificationCoverage) || !timestamp(totals.freshnessAt)
    || totals.successRate !== expectedRate(integerCount(totals.successCount)!, integerCount(totals.classifiedCalls)!)
    || totals.classificationCoverage !== expectedRate(integerCount(totals.classifiedCalls)!, integerCount(totals.calls)!)) return false;
  if (!Array.isArray(daily) || daily.length !== window.days || !daily.every((item, index) => isRecord(item)
    && hasKeys(item, ["date", ...countKeys]) && date(item.date)
    && item.date === new Date(start + index * 86_400_000).toISOString().slice(0, 10) && counts(item))) return false;
  if (!Array.isArray(operations) || operations.length > (filter.limit as number) || !operations.every((item) => isRecord(item)
    && hasKeys(item, ["route", "operation", ...countKeys, "distinctUsers", "successRate", "avgDurationMs", "freshnessAt"])
    && typeof item.route === "string" && typeof item.operation === "string" && counts(item) && integerCount(item.distinctUsers) !== undefined
    && integerCount(item.distinctUsers)! <= integerCount(item.calls)!
    && rate(item.successRate) && item.successRate === expectedRate(integerCount(item.successCount)!, integerCount(item.successCount)! + integerCount(item.failureCount)!)
    && (item.avgDurationMs === null || finiteNumber(item.avgDurationMs))
    && timestamp(item.freshnessAt))) return false;
  return Array.isArray(errors) && errors.length <= (filter.limit as number) && errors.every((item) => isRecord(item)
    && hasKeys(item, ["httpStatus", "errorCode", "route", "operation", "calls", "distinctUsers", "freshnessAt"])
    && count(item.httpStatus) && item.httpStatus >= 100 && item.httpStatus <= 599 && (item.httpStatus < 200 || item.httpStatus > 299)
    && typeof item.errorCode === "string" && typeof item.route === "string" && typeof item.operation === "string"
    && integerCount(item.calls) !== undefined && integerCount(item.distinctUsers) !== undefined
    && integerCount(item.distinctUsers)! <= integerCount(item.calls)! && timestamp(item.freshnessAt));
}

export function matchesAdminOperationsV2Filters(value: unknown, filters: { from?: string; to?: string; userId?: string; limit?: number }): boolean {
  if (!isRecord(value) || !isRecord(value.window) || !isRecord(value.filter)) return false;
  const { window, filter } = value;
  if (filters.from !== undefined && (window.from !== filters.from || window.to !== filters.to)) return false;
  if (filters.from === undefined && window.days !== 7) return false;
  if (filter.limit !== (filters.limit ?? 20)) return false;
  return filters.userId === undefined ? filter.user === undefined
    : isRecord(filter.user) && userId(filter.user.id) === BigInt(filters.userId);
}

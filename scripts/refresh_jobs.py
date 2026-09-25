#!/usr/bin/env python3
"""Build a normalized public job feed from explicitly configured public sources."""

from __future__ import annotations

import argparse
import csv
import hashlib
import html
import io
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


USER_AGENT = "autumn-job-workbench/0.14 (+public feed builder)"

JOB_TYPES = {"技术研发", "数据算法", "产品项目", "设计体验", "运营市场", "销售客户", "职能管培", "供应链制造", "金融法务", "教育医疗", "其他校招"}
JOB_TYPE_RULES = [
    ("数据算法", ("算法", "数据科学", "数据分析", "数据开发", "大数据", "机器学习", "深度学习", "人工智能", "nlp", "商业分析", "数仓")),
    ("技术研发", ("开发工程师", "软件工程", "前端", "后端", "客户端", "移动端", "测试工程", "运维", "研发", "嵌入式", "硬件", "芯片", "web", "java", "c++", "golang", "python")),
    ("产品项目", ("产品经理", "产品运营", "产品设计", "项目经理", "项目管理", "解决方案", "需求分析")),
    ("设计体验", ("设计师", "视觉设计", "交互设计", "用户体验", "ui设计", "ux设计", "工业设计", "内容设计")),
    ("运营市场", ("运营", "市场", "品牌", "公关", "新媒体", "内容", "增长", "活动策划", "广告")),
    ("销售客户", ("销售", "客户成功", "客户经理", "商务", "售前", "售后", "渠道", "采购")),
    ("职能管培", ("管培", "人力", "招聘", "行政", "财务", "审计", "法务", "合规", "秘书", "翻译")),
    ("供应链制造", ("供应链", "物流", "计划", "生产", "制造", "质量", "工艺", "机械", "汽车", "采购工程")),
    ("金融法务", ("投资", "证券", "银行", "保险", "信贷", "风控", "金融", "法务", "法律")),
    ("教育医疗", ("教师", "教育", "课程", "医疗", "医生", "护士", "药学", "临床", "医药")),
]
CITY_PROVINCES = {
    "北京": "北京", "上海": "上海", "天津": "天津", "重庆": "重庆", "广州": "广东", "深圳": "广东", "珠海": "广东", "佛山": "广东", "东莞": "广东", "杭州": "浙江", "宁波": "浙江", "温州": "浙江", "南京": "江苏", "苏州": "江苏", "无锡": "江苏", "成都": "四川", "绵阳": "四川", "武汉": "湖北", "长沙": "湖南", "郑州": "河南", "西安": "陕西", "合肥": "安徽", "福州": "福建", "厦门": "福建", "济南": "山东", "青岛": "山东", "沈阳": "辽宁", "大连": "辽宁", "哈尔滨": "黑龙江", "长春": "吉林", "南昌": "江西", "昆明": "云南", "贵阳": "贵州", "太原": "山西", "石家庄": "河北", "乌鲁木齐": "新疆", "兰州": "甘肃", "海口": "海南", "南宁": "广西", "呼和浩特": "内蒙古", "拉萨": "西藏", "银川": "宁夏", "西宁": "青海", "香港": "香港", "澳门": "澳门", "台北": "台湾"
}
PROVINCES = tuple({"北京", "上海", "天津", "重庆", "广东", "浙江", "江苏", "四川", "湖北", "湖南", "河南", "陕西", "安徽", "福建", "山东", "辽宁", "黑龙江", "吉林", "江西", "云南", "贵州", "山西", "河北", "新疆", "甘肃", "海南", "广西", "内蒙古", "西藏", "宁夏", "青海", "香港", "澳门", "台湾"})
FOREIGN_COMPANY_PATTERN = re.compile(r"微软|英特尔|英伟达|苹果|亚马逊|谷歌|Google|Microsoft|Amazon|Apple|IBM|SAP|西门子|博世(?:（中国|中国)|联合利华|宝洁|欧莱雅|耐克|阿迪达斯|德勤|普华永道|安永|毕马威|埃森哲|汇丰|渣打|花旗|摩根|可口可乐|百事|星巴克|麦肯锡|波士顿咨询|贝恩|Airbnb|Stripe|Datadog|Cloudflare|Coinbase", re.I)
STATE_COMPANY_PATTERN = re.compile(r"国企|央企|国有企业|事业单位|国家电网|南方电网|中国石油|中石油|中国石化|中石化|中国移动|中国联通|中国电信|中国建筑|中建集团|中国中铁|中国铁建|中国交建|中国航天|中国航空|中国兵器|中国烟草|中国铁路|国铁|中核|中航|中粮|中储粮|中国船舶|中国电子|中国华能|国家能源", re.I)
MAINLAND_LOCATION_PATTERN = re.compile(r"北京|上海|天津|重庆|广州|深圳|杭州|宁波|南京|苏州|无锡|成都|武汉|长沙|郑州|西安|合肥|福州|厦门|济南|青岛|沈阳|大连|哈尔滨|长春|南昌|昆明|贵阳|太原|石家庄|乌鲁木齐|兰州|海口|南宁|呼和浩特|拉萨|银川|西宁|中国大陆|中国内地|Mainland China|China(?:\s|[-,]|$)", re.I)


def clean(value: Any, limit: int = 12000) -> str:
    if value is None:
        return ""
    return str(value).strip()[:limit]


def plain_html(value: Any, limit: int = 12000) -> str:
    return re.sub(r"<[^>]+>", " ", html.unescape(clean(value, limit)))


def classify_job_type(job: dict[str, Any]) -> str:
    explicit = clean(job.get("jobType") or job.get("type"), 100)
    if explicit in JOB_TYPES:
        return explicit
    haystack = " ".join(clean(job.get(key), 12000) for key in ("title", "tags", "description", "jobType", "type")).lower()
    for job_type, keywords in JOB_TYPE_RULES:
        if any(keyword.lower() in haystack for keyword in keywords):
            return job_type
    return "其他校招"


def region_parts(job: dict[str, Any]) -> tuple[str, str]:
    raw = re.sub(r"[，,、|/\\]+", " ", clean(job.get("location") or job.get("city"), 120))
    raw = re.sub(r"\s+", " ", raw).strip()
    explicit_province = re.sub(r"省$", "", clean(job.get("province"), 40))
    explicit_city = re.sub(r"市$", "", clean(job.get("city"), 40))
    if explicit_province and explicit_city and explicit_province != explicit_city:
        return explicit_province, explicit_city
    province = next((name for name in PROVINCES if raw.startswith(name) or f"{name}省" in raw or f"{name}自治区" in raw), None)
    province = province or next((province for city, province in CITY_PROVINCES.items() if city in raw), "其他地区")
    city = explicit_city or next((city for city in CITY_PROVINCES if city in raw), None)
    if not city:
        match = re.search(r"([^\s-]{2,8}?)(?:市|区|县)", raw)
        city = match.group(1) if match else (province if province in {"北京", "上海", "天津", "重庆"} else "未标注")
    return province, city


def is_mainland_location(value: Any) -> bool:
    location = clean(value, 160)
    if not location or re.search(r"香港|澳门|Hong Kong|Macau|海外|海外地区", location, re.I):
        return False
    return bool(MAINLAND_LOCATION_PATTERN.search(location))


def get_json(url: str, max_bytes: int) -> Any:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=45) as response:
        length = int(response.headers.get("Content-Length") or 0)
        if length and length > max_bytes:
            raise ValueError(f"source is larger than configured max_bytes: {length}")
        payload = response.read(max_bytes + 1)
    if len(payload) > max_bytes:
        raise ValueError("source exceeded configured max_bytes while downloading")
    return json.loads(payload.decode("utf-8-sig"))


def get_text(url: str, max_bytes: int) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/csv,text/plain"})
    with urllib.request.urlopen(request, timeout=45) as response:
        payload = response.read(max_bytes + 1)
    if len(payload) > max_bytes:
        raise ValueError("source exceeded configured max_bytes while downloading")
    return payload.decode("utf-8-sig")


def normalize(job: dict[str, Any], source: dict[str, Any]) -> dict[str, Any] | None:
    company = clean(job.get("company"), 160) or "未知公司"
    title = clean(job.get("title"), 240)
    if not title:
        return None
    url = clean(job.get("url"), 4000)
    identity = url or "|".join((company, title, clean(job.get("location"), 120)))
    digest = hashlib.sha256(identity.lower().encode("utf-8")).hexdigest()[:20]
    tags = job.get("tags") or []
    if isinstance(tags, str):
        tags = [part.strip() for part in tags.replace("，", ",").split(",") if part.strip()]
    province, city = region_parts(job)
    explicit_company_type = clean(job.get("companyType"), 40) or clean(source.get("companyType"), 40)
    company_haystack = " ".join((company, " ".join(tags), clean(job.get("description"), 12000)))
    if explicit_company_type and re.search(r"外企|外资|跨国|foreign|mnc", explicit_company_type, re.I):
        company_type = "外企（中国大陆）" if source.get("mainland_china_only") or is_mainland_location(job.get("location")) else "外企（其他地区）"
    elif explicit_company_type and re.search(r"国企|央企|国有|事业单位|公共部门", explicit_company_type, re.I):
        company_type = "国企/央企"
    elif explicit_company_type:
        company_type = explicit_company_type
    elif STATE_COMPANY_PATTERN.search(company_haystack):
        company_type = "国企/央企"
    else:
        company_type = "外企（中国大陆）" if FOREIGN_COMPANY_PATTERN.search(company) and is_mainland_location(job.get("location")) else "外企（其他地区）" if FOREIGN_COMPANY_PATTERN.search(company) else "国内/综合"
    return {
        "id": f"public-{digest}",
        "company": company,
        "title": title,
        "location": clean(job.get("location"), 120),
        "province": province,
        "city": city,
        "url": url,
        "platform": clean(job.get("platform"), 100) or source["name"],
        "jobType": classify_job_type({**job, "tags": " ".join(tags) if isinstance(tags, list) else tags}),
        "tags": list(dict.fromkeys(clean(tag, 80) for tag in tags if clean(tag, 80)))[:20],
        "description": clean(job.get("description")),
        "publishedAt": clean(job.get("publishedAt"), 30),
        "deadline": clean(job.get("deadline"), 30),
        "sourceId": source["id"],
        "sourceAttribution": source.get("attribution", source["url"]),
        "companyType": company_type,
    }


def adapt_jobhunter(payload: Any) -> list[dict[str, Any]]:
    rows = payload.get("jobs", []) if isinstance(payload, dict) else []
    result = []
    for row in rows:
        if not isinstance(row, dict) or row.get("active") is False or row.get("expired") is True:
            continue
        result.append({
            "company": row.get("company"),
            "title": row.get("title"),
            "location": "-".join(filter(None, (clean(row.get("city")), clean(row.get("district"))))),
            "url": row.get("applyLink") or row.get("link"),
            "platform": row.get("sourceName") or row.get("source"),
            "jobType": row.get("recruitType") or row.get("entryType"),
            "tags": [*(row.get("tags") or []), clean(row.get("categoryGroup")), clean(row.get("companyGroup"))],
            "description": row.get("desc"),
            "publishedAt": row.get("publishDate"),
            "deadline": row.get("deadline"),
        })
    return result


def adapt_new_grad(payload: Any) -> list[dict[str, Any]]:
    rows = payload.get("positions", []) if isinstance(payload, dict) else []
    result = []
    for row in rows:
        company = row.get("company") or {}
        announcement = row.get("announcement") or {}
        result.append({
            "company": company.get("name"),
            "title": announcement.get("title") or f"{company.get('name', '')} 校园招聘",
            "location": "",
            "url": company.get("website") or announcement.get("url"),
            "platform": "New Grad Positions",
            "jobType": row.get("type") or "校招",
            "tags": [company.get("type"), str(row.get("graduationYear") or "")],
            "description": "",
            "publishedAt": announcement.get("date"),
            "deadline": "",
        })
    return result


def adapt_standard(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if isinstance(payload, dict) and isinstance(payload.get("jobs"), list):
        return [row for row in payload["jobs"] if isinstance(row, dict)]
    return []


def adapt_greenhouse(payload: Any, source: dict[str, Any]) -> list[dict[str, Any]]:
    rows = payload.get("jobs", []) if isinstance(payload, dict) else []
    company = clean(source.get("company"), 160) or clean(source.get("name"), 160)
    result = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        location = row.get("location") or {}
        location_name = location.get("name") if isinstance(location, dict) else location
        if source.get("mainland_china_only") and not is_mainland_location(location_name):
            continue
        result.append({
            "company": row.get("company_name") or company,
            "title": row.get("title"),
            "location": location_name,
            "url": row.get("absolute_url"),
            "platform": f"{company} 官方招聘",
            "jobType": row.get("title"),
            "tags": ["外企", company, clean(row.get("language"), 40)],
            "description": plain_html(row.get("content")),
            "publishedAt": row.get("first_published") or row.get("updated_at"),
            "deadline": row.get("application_deadline"),
            "companyType": "外企",
        })
    return result


def adapt_csv(text: str) -> list[dict[str, Any]]:
    return list(csv.DictReader(io.StringIO(text)))


def adapt_markdown_table(text: str) -> list[dict[str, Any]]:
    aliases = {
        "company": {"company", "公司", "企业", "公司名称"},
        "title": {"title", "job", "position", "岗位", "职位", "招聘岗位"},
        "location": {"location", "city", "地点", "城市", "工作地点"},
        "url": {"url", "link", "链接", "投递链接", "岗位链接", "招聘链接"},
        "jobType": {"type", "jobtype", "类型", "岗位类型", "招聘类型"},
        "tags": {"tags", "keywords", "标签", "关键词"},
        "publishedAt": {"publishedat", "发布时间", "发布日期"},
        "deadline": {"deadline", "截止日期", "截止时间"},
    }

    def cells(line: str) -> list[str]:
        return [cell.strip() for cell in line.strip().strip("|").split("|")]

    def plain(value: str) -> str:
        return re.sub(r"\[([^]]+)\]\([^)]+\)", r"\1", value).strip()

    def link(value: str) -> str:
        match = re.search(r"\[[^]]+\]\((https?://[^)]+)\)", value)
        if match:
            return match.group(1)
        match = re.search(r"https?://[^\s)>]+", value)
        return match.group(0) if match else ""

    lines = text.replace("\r", "").split("\n")
    rows: list[dict[str, Any]] = []
    for index in range(len(lines) - 2):
        if "|" not in lines[index] or not re.match(r"^\s*\|?\s*:?-{3,}", lines[index + 1]):
            continue
        headers = [plain(value).lower().replace(" ", "").replace("_", "") for value in cells(lines[index])]
        column_map = {}
        for field, names in aliases.items():
            for column, header in enumerate(headers):
                if header in names:
                    column_map[field] = column
                    break
        if "company" not in column_map or "title" not in column_map:
            continue
        cursor = index + 2
        while cursor < len(lines) and "|" in lines[cursor] and lines[cursor].strip():
            values = cells(lines[cursor])
            raw = {field: values[column] if column < len(values) else "" for field, column in column_map.items()}
            url_value = raw.get("url", "")
            raw["url"] = link(url_value) or next((link(value) for value in values if link(value)), "")
            raw["company"] = plain(raw.get("company", ""))
            raw["title"] = plain(raw.get("title", ""))
            raw["location"] = plain(raw.get("location", ""))
            rows.append(raw)
            cursor += 1
    return rows


def collect(source: dict[str, Any]) -> list[dict[str, Any]]:
    max_bytes = int(source.get("max_bytes") or 15 * 1024 * 1024)
    source_type = source["type"]
    if source_type == "csv":
        rows = adapt_csv(get_text(source["url"], max_bytes))
    elif source_type == "markdown-table":
        rows = adapt_markdown_table(get_text(source["url"], max_bytes))
    else:
        payload = get_json(source["url"], max_bytes)
        adapters = {
            "jobhunter1-json": adapt_jobhunter,
            "new-grad-positions-json": adapt_new_grad,
            "standard-json": adapt_standard,
            "greenhouse-json": lambda payload: adapt_greenhouse(payload, source),
        }
        if source_type not in adapters:
            raise ValueError(f"unsupported source type: {source_type}")
        rows = adapters[source_type](payload)
    return [item for row in rows if (item := normalize(row, source))]


def build(config_path: Path, output_path: Path, allow_partial: bool) -> dict[str, Any]:
    config = json.loads(config_path.read_text(encoding="utf-8"))
    all_jobs: dict[str, dict[str, Any]] = {}
    status = []
    for source in config.get("sources", []):
        if not source.get("enabled", False):
            status.append({"id": source.get("id"), "name": source.get("name"), "status": "disabled", "count": 0})
            continue
        try:
            jobs = collect(source)
            for job in jobs:
                all_jobs[job["id"]] = job
            status.append({"id": source["id"], "name": source["name"], "status": "ok", "count": len(jobs), "attribution": source.get("attribution")})
        except Exception as error:  # Network and source schema failures are reported per source.
            status.append({"id": source.get("id"), "name": source.get("name"), "status": "error", "count": 0, "error": str(error)[:500]})
            if not allow_partial:
                raise
    successful = [item for item in status if item["status"] == "ok"]
    if not successful:
        raise RuntimeError("no enabled source completed successfully")
    jobs = sorted(all_jobs.values(), key=lambda job: (job.get("publishedAt", ""), job["company"], job["title"]), reverse=True)
    document = {
        "meta": {
            "schemaVersion": 1,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "total": len(jobs),
            "sources": status,
        },
        "jobs": jobs,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(document, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return document


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sources", type=Path, default=Path("job-sources/sources.json"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--allow-partial", action="store_true")
    args = parser.parse_args()
    document = build(args.sources, args.output, args.allow_partial)
    print(json.dumps(document["meta"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

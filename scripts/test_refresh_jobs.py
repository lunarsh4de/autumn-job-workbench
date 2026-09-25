import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import refresh_jobs


class RefreshJobsTests(unittest.TestCase):
    def test_markdown_table_adapter_reads_chinese_headers_and_links(self):
        source = """
| 公司 | 岗位 | 地点 | 投递链接 |
| --- | --- | --- | --- |
| 示例科技 | 数据分析师 | 上海 | [投递](https://example.com/job/1) |
"""
        self.assertEqual(refresh_jobs.adapt_markdown_table(source), [{
            "company": "示例科技", "title": "数据分析师", "location": "上海", "url": "https://example.com/job/1"
        }])

    def test_build_deduplicates_and_records_source_health(self):
        config = {"sources": [{
            "id": "test", "name": "测试源", "type": "standard-json", "url": "https://example.com/jobs.json", "enabled": True
        }]}
        rows = [
            {"company": "甲", "title": "产品经理", "url": "https://example.com/1"},
            {"company": "甲", "title": "产品经理", "url": "https://example.com/1"},
        ]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config_path = root / "sources.json"
            output_path = root / "jobs.json"
            config_path.write_text(json.dumps(config, ensure_ascii=False), encoding="utf-8")
            with patch.object(refresh_jobs, "get_json", return_value=rows):
                result = refresh_jobs.build(config_path, output_path, False)
            self.assertEqual(result["meta"]["total"], 1)
            self.assertEqual(result["meta"]["sources"][0]["status"], "ok")
            self.assertEqual(json.loads(output_path.read_text(encoding="utf-8"))["jobs"][0]["company"], "甲")

    def test_normalize_classifies_role_and_derives_region(self):
        job = refresh_jobs.normalize({"company": "示例", "title": "数据分析师", "location": "浙江省杭州市余杭区"}, {"id": "test", "name": "测试源", "url": "https://example.com"})
        self.assertEqual(job["jobType"], "数据算法")
        self.assertEqual(job["province"], "浙江")
        self.assertEqual(job["city"], "杭州")

    def test_greenhouse_keeps_mainland_china_and_excludes_hong_kong(self):
        payload = {"jobs": [
            {"title": "China Product Manager", "location": {"name": "Shanghai, China"}, "absolute_url": "https://example.com/cn", "content": "<p>Build&nbsp;products</p>"},
            {"title": "APAC Product Manager", "location": {"name": "Hong Kong"}, "absolute_url": "https://example.com/hk"},
            {"title": "Singapore Product Manager", "location": {"name": "Singapore"}, "absolute_url": "https://example.com/sg"},
        ]}
        source = {"id": "greenhouse", "name": "外企", "company": "Airbnb", "mainland_china_only": True, "url": "https://example.com"}
        rows = refresh_jobs.adapt_greenhouse(payload, source)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["location"], "Shanghai, China")
        self.assertEqual(rows[0]["companyType"], "外企")
        self.assertEqual(rows[0]["description"], " Build\xa0products ")
        normalized = refresh_jobs.normalize(rows[0], source)
        self.assertEqual(normalized["companyType"], "外企（中国大陆）")


if __name__ == "__main__":
    unittest.main()

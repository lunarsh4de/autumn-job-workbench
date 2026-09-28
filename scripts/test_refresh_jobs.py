import json
import subprocess
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

    def test_build_keeps_first_source_when_urls_overlap(self):
        config = {"sources": [
            {"id": "official", "name": "公司校园招聘官网", "type": "standard-json", "url": "https://example.com/official", "enabled": True},
            {"id": "aggregate", "name": "公开聚合", "type": "standard-json", "url": "https://example.com/aggregate", "enabled": True},
        ]}
        responses = {
            "https://example.com/official": [{"company": "甲", "title": "研发工程师", "url": "https://company.example/job/1", "platform": "公司校园招聘官网"}],
            "https://example.com/aggregate": [{"company": "甲", "title": "研发工程师", "url": "https://company.example/job/1", "platform": "牛客"}],
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config_path = root / "sources.json"
            output_path = root / "jobs.json"
            config_path.write_text(json.dumps(config, ensure_ascii=False), encoding="utf-8")
            with patch.object(refresh_jobs, "get_json", side_effect=lambda url, _max_bytes: responses[url]):
                result = refresh_jobs.build(config_path, output_path, False)
        self.assertEqual(result["meta"]["total"], 1)
        self.assertEqual(result["jobs"][0]["platform"], "公司校园招聘官网")
        self.assertEqual(result["jobs"][0]["sourceId"], "official")

    def test_normalize_classifies_role_and_derives_region(self):
        job = refresh_jobs.normalize({"company": "示例", "title": "数据分析师", "location": "浙江省杭州市余杭区"}, {"id": "test", "name": "测试源", "url": "https://example.com"})
        self.assertEqual(job["jobType"], "数据算法")
        self.assertEqual(job["province"], "浙江")
        self.assertEqual(job["city"], "杭州")

    def test_region_parts_cover_expanded_mainland_cities(self):
        self.assertEqual(refresh_jobs.region_parts({"location": "江苏-泰州-海陵区"}), ("江苏", "泰州"))
        self.assertEqual(refresh_jobs.region_parts({"location": "新余-新余-渝水区"}), ("江西", "新余"))

    def test_classifies_common_bilingual_job_titles(self):
        self.assertEqual(refresh_jobs.classify_job_type({"title": "Product Operations Intern"}), "产品项目")
        self.assertEqual(refresh_jobs.classify_job_type({"title": "Management Trainee"}), "职能管培")
        self.assertEqual(refresh_jobs.classify_job_type({"title": "User Growth Intern"}), "运营市场")
        self.assertEqual(refresh_jobs.classify_job_type({"title": "软件实施工程师"}), "技术研发")
        self.assertEqual(refresh_jobs.classify_job_type({"title": "系统策划"}), "产品项目")
        self.assertEqual(refresh_jobs.classify_job_type({"title": "文员实习生"}), "职能管培")
        self.assertEqual(refresh_jobs.classify_job_type({"title": "集控巡检"}), "供应链制造")
        self.assertEqual(refresh_jobs.classify_job_type({"title": "茶原料开发"}), "供应链制造")

    def test_uses_source_category_tags_only_as_a_fallback(self):
        self.assertEqual(refresh_jobs.classify_job_type({"title": "未命名技术岗", "tags": ["技术/IT"]}), "技术研发")
        self.assertEqual(refresh_jobs.classify_job_type({"title": "游戏动作实习生", "tags": ["产品/设计"]}), "设计体验")
        self.assertEqual(refresh_jobs.classify_job_type({"title": "产品经理", "tags": ["技术/IT"]}), "产品项目")

    def test_classifies_low_ambiguity_long_tail_roles(self):
        self.assertEqual(refresh_jobs.classify_job_type({"title": "实习施工员"}), "供应链制造")
        self.assertEqual(refresh_jobs.classify_job_type({"title": "置业顾问"}), "销售客户")
        self.assertEqual(refresh_jobs.classify_job_type({"title": "游戏3D场景实习生"}), "设计体验")
        self.assertEqual(refresh_jobs.classify_job_type({"title": "风险管理"}), "金融法务")
        self.assertEqual(refresh_jobs.classify_job_type({"title": "动物实验实习生"}), "教育医疗")

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

    def test_tencent_campus_adapter_builds_real_detail_links(self):
        source = {
            "id": "tencent", "name": "腾讯校园招聘官网", "type": "tencent-campus", "enabled": True,
            "company": "腾讯", "url": "https://example.com/tencent", "page_size": 100,
        }
        response = {"data": {"count": 1, "positionList": [{
            "positionTitle": "AI全栈工程师", "workCities": "深圳总部 北京 ",
            "projectName": "应届毕业生", "recruitLabelName": "应届毕业生", "postId": "123",
        }]}}
        with patch.object(refresh_jobs, "post_json", return_value=response):
            jobs = refresh_jobs.collect(source)
        self.assertEqual(jobs[0]["url"], "https://join.qq.com/post.html?postid=123")
        self.assertEqual(jobs[0]["platform"], "腾讯校园招聘官网")

    def test_meituan_campus_adapter_keeps_job_description(self):
        source = {
            "id": "meituan", "name": "美团校园招聘官网", "type": "meituan-campus", "enabled": True,
            "company": "美团", "url": "https://example.com/meituan", "page_size": 100,
        }
        response = {"data": {"page": {"totalCount": 1}, "list": [{
            "jobUnionId": "456", "name": "后端开发工程师", "jobStatus": "000",
            "cityList": [{"name": "北京市"}], "jobFamily": "技术类", "jobFamilyGroup": "软件",
            "jobDuty": "负责服务开发", "jobRequirement": "本科及以上", "refreshTime": 1786960999000,
        }]}}
        with patch.object(refresh_jobs, "post_json", return_value=response):
            jobs = refresh_jobs.collect(source)
        self.assertIn("jobUnionId=456", jobs[0]["url"])
        self.assertIn("负责服务开发", jobs[0]["description"])

    def test_byd_campus_adapter_uses_2027_official_positions(self):
        source = {
            "id": "byd", "name": "比亚迪校园招聘官网", "type": "byd-campus", "enabled": True,
            "company": "比亚迪", "url": "https://example.com/byd", "page_size": 100,
        }
        response = {"data": [{
            "id": "789", "jobName": "高级车身集成工程师", "jobType": "研发技术",
            "workPlace": "深圳市", "batch": 2027, "updateTime": "2026-09-13",
        }], "page": {"totalCount": 1}}
        with patch.object(refresh_jobs, "post_json", return_value=response):
            jobs = refresh_jobs.collect(source)
        self.assertIn("schoolPositionDetail?id=789", jobs[0]["url"])
        self.assertIn("2027届", jobs[0]["tags"])

    def test_moka_campus_uses_node_helper_and_job_route(self):
        source = {
            "id": "tesla", "name": "特斯拉校园招聘官网", "type": "moka-campus", "enabled": True,
            "company": "特斯拉中国", "url": "https://example.com/campus", "detail_base_url": "https://example.com/campus",
            "org_id": "tesla", "site_id": "41460",
        }
        helper_payload = {"jobs": [{
            "id": "abc", "title": "2027届-软件开发实习生", "status": "open",
            "locations": [{"provinceName": "上海市", "cityName": "浦东新区"}],
            "publishedAt": "2026-09-28T14:20:14", "zhineng": {"name": "产品研发"},
        }]}
        completed = subprocess.CompletedProcess(["node"], 0, json.dumps(helper_payload, ensure_ascii=False), "")
        with patch.object(refresh_jobs.subprocess, "run", return_value=completed):
            jobs = refresh_jobs.collect(source)
        self.assertEqual(jobs[0]["url"], "https://example.com/campus#/job/abc")
        self.assertIn("实习", jobs[0]["tags"])

    def test_enabled_config_has_real_official_sources_not_placeholders(self):
        config = json.loads((Path(__file__).parents[1] / "job-sources" / "sources.json").read_text(encoding="utf-8"))
        enabled = [source for source in config["sources"] if source.get("enabled")]
        self.assertTrue({"tencent-campus", "meituan-campus", "byd-campus", "moka-campus"}.issubset({source["type"] for source in enabled}))

    def test_normalize_classifies_known_state_owned_employer(self):
        job = refresh_jobs.normalize({"company": "国家电网有限公司", "title": "技术研发", "location": "北京"}, {"id": "test", "name": "测试源", "url": "https://example.com"})
        self.assertEqual(job["companyType"], "国企/央企")

    def test_normalize_separates_non_mainland_foreign_employers(self):
        job = refresh_jobs.normalize({"company": "Google", "title": "软件工程师", "location": "新加坡"}, {"id": "test", "name": "测试源", "url": "https://example.com"})
        self.assertEqual(job["companyType"], "外企（其他地区）")

    def test_normalize_keeps_mixed_mainland_and_hong_kong_roles_in_mainland_bucket(self):
        source = {"id": "test", "name": "测试源", "url": "https://example.com"}
        mainland = refresh_jobs.normalize({"company": "埃森哲", "title": "校招", "location": "广州、深圳、北京、上海、香港", "companyType": "外企"}, source)
        expanded_mainland = refresh_jobs.normalize({"company": "埃森哲", "title": "校招", "location": "嘉兴、香港", "companyType": "外企"}, source)
        hong_kong_only = refresh_jobs.normalize({"company": "埃森哲", "title": "校招", "location": "香港", "companyType": "外企"}, source)
        self.assertEqual(mainland["companyType"], "外企（中国大陆）")
        self.assertEqual(expanded_mainland["companyType"], "外企（中国大陆）")
        self.assertEqual(hong_kong_only["companyType"], "外企（其他地区）")


if __name__ == "__main__":
    unittest.main()

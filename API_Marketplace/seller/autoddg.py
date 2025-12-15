from huggingface_hub import login
from seller.db import FaissDB
import torch
from seller.llm import LLMModel
import os
from dotenv import load_dotenv
import pandas as pd
import datamart_profiler as dp
import requests
import random
import re
from datetime import datetime
from typing import List, Any
import json
from io import StringIO

load_dotenv()

class AutoDDG:
    """
    AutoDDG is a class that contains a question and an answer
    """
    def __init__(self):

        hf_token = os.getenv("HUGGINGFACE_TOKEN")
        if hf_token:
            login(hf_token)
        else:
            print("Warning: HUGGINGFACE_TOKEN not set. Skipping HuggingFace login.")

        self.device = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
        self.llm_model = LLMModel()
        self.db = FaissDB()

    def prepare_csv_directory(self, title: str, csv_files_path: list[str], output_path: str = "merged.csv"):

        if len(csv_files_path) == 0:
            raise ValueError("No CSV files found in the directory.")

        if len(csv_files_path) == 1:
            try:
                response = requests.get(csv_files_path[0])
                df = pd.read_csv(StringIO(response.text))
                df.to_csv(output_path, index=False)
                return output_path
            except Exception as e:
                print(f"Error in preparing CSV directory: {e}")
                raise ValueError(f"Error in preparing CSV directory: {e}")

        print(f"Found {len(csv_files_path)} CSV files, merging...")

        merged_df_list = []

        for csv_file_path in csv_files_path:
            try:
                response = requests.get(csv_file_path)
                df = pd.read_csv(StringIO(response.text))
                df = df.add_prefix(title + "_") # add prefix to the column name
                merged_df_list.append(df)
            except Exception as e:
                print(f"Error in preparing CSV directory: {e}")
                raise ValueError(f"Error in preparing CSV directory: {e}")

        merged_df = pd.concat(merged_df_list, axis=1)

        merged_df.to_csv(output_path, index=False)
        print(f"Created merged CSV file: {output_path}")

        return output_path

    def get_sample(self, values: list[Any], sample_size: int) -> list[Any]:
            """Get sample random from column."""
            values = [v for v in values if pd.notna(v)]
            if len(values) <= sample_size:
                return values
            return random.sample(values, sample_size)
        
    def fix_json_response(self, response_text: str) -> str:
        """Fix the JSON response"""
        match = re.search(r"\{.*\}", response_text, re.DOTALL)
        if not match:
            return response_text
        
        response_body = match.group()
        open_braces = response_body.count("{")
        close_braces = response_body.count("}")
        response_body += "}" * (open_braces - close_braces)
        response_body = re.sub(r",\s*}", "}", response_body)
        return response_body

    def dataset_profiler(self, metadata: dict):
        """Profile the dataset from metadata"""
        try:
            profile_summary = []
            for column_meta in metadata.get("columns", []):
                column_summary = f"**{column_meta['name']}**: "
            
                structural_type = column_meta.get("structural_type", "Unknown")
                column_summary += f"Data is of type {structural_type.split('/')[-1].lower()}. "
            
                if "num_distinct_values" in column_meta:
                    num_distinct_values = column_meta["num_distinct_values"]
                    column_summary += f"There are {num_distinct_values} unique values. "
                    
                if "coverage" in column_meta:
                    low = 0
                    high = 0
                    for coverage in column_meta["coverage"]:
                        lower_bound = coverage["range"].get("gte", low)
                        upper_bound = coverage["range"].get("lte", high)
                        low = min(low, lower_bound)
                        high = max(high, upper_bound)
                    column_summary += f"Coverage spans from {low} to {high}. "
            
                profile_summary.append(column_summary)
            
            final_profile_summary = ("The key data profile information for this dataset includes:\n" + "\n".join(profile_summary))
            print("Dataset profile", final_profile_summary)
            semantic_summary: List[str] = []
            if "temporal_coverage" in metadata:
                for temp_cov in metadata["temporal_coverage"]:
                    column_names = ", ".join(temp_cov.get("column_names", []))
                    temporal_resolution = temp_cov.get("temporal_resolution", "unknown")
                    range_values = [
                        entry["range"].get("gte")
                        for entry in temp_cov.get("ranges", [])
                        if entry.get("range")
                    ] + [
                        entry["range"].get("lte")
                        for entry in temp_cov.get("ranges", [])
                        if entry.get("range")
                    ]
                    range_values = [value for value in range_values if value is not None]
                    if range_values:
                        min_value = datetime.fromtimestamp(min(range_values)).strftime("%Y-%m-%d")
                        max_value = datetime.fromtimestamp(max(range_values)).strftime("%Y-%m-%d")
                        date_range = f"from {min_value} to {max_value}"
                        semantic_summary.append(
                            f"**Temporal coverage** for columns {column_names} with resolution "
                            f"{temporal_resolution}, covering {date_range}."
                        )
            
            if "spatial_coverage" in metadata:
                for spatial_cov in metadata["spatial_coverage"]:
                    column_names = ", ".join(spatial_cov.get("column_names", []))
                    spatial_resolution = spatial_cov.get("type", "unknown")
                    semantic_summary.append(
                        f"**Spatial coverage** for columns {column_names}, with type {spatial_resolution}."
                    )
            
            final_semantic_summary_metadata = "\n".join(semantic_summary)
            return final_profile_summary, final_semantic_summary_metadata
        except Exception as e:
            print("Error in dataset profiler", e)
            return ""

    def semantic_profiler(self, dataset_path: str, semantic_summary_metadata: str):
        """Profile the dataset from semantic summary metadata"""
        try:
            sample_size = 5
            df = pd.read_csv(dataset_path)
            semantic_summary = []
            for col in df.columns:
                sample_values = self.get_sample(df[col].tolist(), sample_size)
                is_break = False
                no_try = 0
                while not is_break:
                    semantic_description = self.fix_json_response(self.llm_model.generate_semantic_profile(col, sample_values))
                    try:
                        semantic_description = json.loads(semantic_description)
                        is_break = True
                    except json.JSONDecodeError:
                        semantic_description = None
                        if no_try > 4:
                            is_break = True
                        no_try += 1
                    except Exception as e:
                        print(e)
                if semantic_description == None:
                    continue
                column_summary = f"**{col}**: "
                entity_type = semantic_description.get("Entity Type", "Unknown")
                if entity_type and entity_type.lower() not in {"", "unknown"}:
                    column_summary += f"Represents {entity_type.lower()}. "
                        
                temporal = semantic_description.get("Temporal", {})
                if temporal.get("isTemporal"):
                    resolution = temporal.get("resolution", "unknown")
                    column_summary += f"Contains temporal data (resolution: {resolution}). "
                        
                spatial = semantic_description.get("Spatial", {})
                if spatial.get("isSpatial"):
                    resolution = spatial.get("resolution", "unknown")
                    column_summary += f"Contains spatial data (resolution: {resolution}). "
                        
                domain_type = semantic_description.get("Domain-Specific Types", "Unknown")
                if domain_type and domain_type.lower() not in {"", "unknown"}:
                    column_summary += f"Domain-specific type: {domain_type.lower()}. "
                        
                function_context = semantic_description.get("Function/Usage Context", "Unknown")
                if function_context and function_context.lower() not in {"", "unknown"}:
                    column_summary += f"Function/Usage context: {function_context.lower()}. "
                semantic_summary.append(column_summary)
            
            final_semantic_summary = "The key semantic information for this dataset includes:\n" + "\n".join(
                semantic_summary
            )
            semantic_profile = "\n".join(
                section for section in [semantic_summary_metadata, final_semantic_summary] if section
            )
            print("Semantic profile:", semantic_profile)
            return semantic_profile
        except Exception as e:
            print("Error in semantic profiler", e)
            return ""

    def generate_dataset_topic(self, title: str, original_description: str, dataset_sample: str):
        """Generate dataset topic from title, original description, and dataset sample."""
        try:
            topic = self.llm_model.generate_dataset_topic(title, original_description, dataset_sample)
            return topic
        except Exception as e:
            print("Error in generate dataset topic", e)
            return ""

    def generate_user_focused_description(self, title: str, original_description: str, dataset_sample: str, dataset_profile: str, semantic_profile: str, data_topic: str):
        """Generate user focused description from title, original description, and metadata."""
        try:
            description = self.llm_model.generate_user_focused_description(dataset_sample, dataset_profile, semantic_profile, data_topic)
            return description
        except Exception as e:
            print("Error in generate user focused description", e)
            return ""

    def generate_search_focused_description(self, title: str, user_focused_description: str):
        """Generate search focused description from title, original description, and metadata."""
        try:
            description = self.llm_model.generate_search_focused_description(title, user_focused_description)
            return description
        except Exception as e:
            print("Error in generate search focused description", e)
            return ""

    def generate_dataset_description(self, cid: str, title: str, original_description: str, csv_files_path: list[str]):
        """Generate dataset description from title, original description, and CSV content."""
        try:
            os.makedirs("temp", exist_ok=True)
            dataset_path = self.prepare_csv_directory(title, csv_files_path, "temp/" + title + "merged.csv")
            metadata = dp.process_dataset(dataset_path, include_sample=True, plots=True)
            dataset_profile, semantic_summary_metadata = self.dataset_profiler(metadata)
            print("Dataset profile", dataset_profile)
            semantic_profile = self.semantic_profiler(dataset_path, semantic_summary_metadata)
            print("Semantic profile", semantic_profile)
            dataset_sample = "\r\n".join(metadata["sample"].splitlines()[:5])
            topic = self.generate_dataset_topic(title, original_description, dataset_sample)
            print("Topic", topic)
            user_focused_description = self.generate_user_focused_description(title, original_description, dataset_sample, dataset_profile, semantic_profile, topic)
            print("User focused description", user_focused_description)
            search_focused_description = self.generate_search_focused_description(title, user_focused_description)
            print("Search focused description", search_focused_description)
            self.db.add_text(cid, search_focused_description)
            self.db.save()
            return user_focused_description, search_focused_description
        except Exception as e:
            print("Error in generate dataset description", e)
            return "", ""

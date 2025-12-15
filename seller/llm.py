import gc
import re
import torch
from typing import List, Any
from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig


class LLMModel:
    def __init__(self, model_name="Qwen/Qwen2.5-3B-Instruct"):
        """Initialize LLAMA3 model for information extraction"""
        
        try:
            print("Initializing LLAMA3 Information Extractor...")
            print("=" * 60)
            
            # Configure quantization; fall back if bitsandbytes backend unavailable (e.g., on Windows)
            quantization_config = None
            try:
                import bitsandbytes as bnb  # noqa: F401

                print("Setting up 4-bit quantization...")
                quantization_config = BitsAndBytesConfig(
                    load_in_4bit=True,
                    bnb_4bit_compute_dtype=torch.float16,
                    bnb_4bit_quant_type="nf4",
                    bnb_4bit_use_double_quant=True,
                )
            except Exception as quant_err:
                print(f"Warning: bitsandbytes not available, loading model without 4-bit quantization. Reason: {quant_err}")
            
            # Load tokenizer
            print("Loading tokenizer...")
            self.tokenizer = AutoTokenizer.from_pretrained(
                model_name,
                trust_remote_code=True
            )
            
            # Load model with optimization
            print("Loading LLAMA3 model (this may take 2-3 minutes)...")
            self.model = AutoModelForCausalLM.from_pretrained(
                model_name,
                quantization_config=quantization_config,
                device_map="auto",
                torch_dtype=torch.float16,
                trust_remote_code=True,
                low_cpu_mem_usage=True
            )
            
            # Set pad token properly
            if self.tokenizer.pad_token is None:
                self.tokenizer.pad_token = self.tokenizer.eos_token
                self.tokenizer.pad_token_id = self.tokenizer.eos_token_id
                self.model.config.pad_token_id = self.tokenizer.pad_token_id
            
            # Set to evaluation mode
            self.model.eval()
                
            print("LLAMA3 model loaded successfully!")
            print(f"Model device: {next(self.model.parameters()).device}")
            print(f"Memory allocated: {torch.cuda.memory_allocated()/1e9:.2f} GB")
            
            # Clear cache
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                gc.collect()
                
        except Exception as e:
            print(f"Error loading model: {e}")
            raise
    
    def create_semantic_profile_prompt(self, column_name: str, sample_values: List[Any]) -> str:
        """Generate semantic profile"""
        
        system_prompt = "You are a helpful assistant skilled in dataset semantic analysis."
        template = """
{'Temporal':{'isTemporal': Does this column contain temporal information? Yes or No,'resolution': If Yes, specify the resolution (Year, Month, Day, Hour, etc.).},
 'Spatial': {'isSpatial': Does this column contain spatial information? Yes or No,
             'resolution': If Yes, specify the resolution (Country, State, City, Coordinates, etc.).},
 'Entity Type': What kind of entity does the column describe? (e.g., Person, Location, Organization, Product),
 'Domain-Specific Types': What domain is this column from (e.g., Financial, Healthcare, E-commerce, Climate, Demographic),
 'Function/Usage Context': How might the data be used (e.g., Aggregation Key, Ranking/Scoring, Interaction Data, Measurement).}
"""
        example = """
{
"Domain-Specific Types": "General",
"Entity Type": "Temporal Entity",
"Function/Usage Context": "Aggregation Key",
"Spatial": {"isSpatial": false,
            "resolution": ""},
"Temporal": {"isTemporal": true,
            "resolution": "Year"
}
"""
        user_prompt = f"""
Instruction:
You are a dataset semantic analyzer. Based on the column name and sample values, classify the column into multiple semantic
types.
Categories:
Please group the semantic types under the following categories:
- Temporal
- Spatial
- Entity Type
- Data Format
- Domain-Specific Types
- Function/Usage Context
Template Reference:
Following is the template:
```
{template}
```
Rules:
(1) All keys from the template must be present in the response.
(2) All keys and string values must be enclosed in double quotes.
(3) There must be no trailing commas.
(4) Use booleans (true/false) and numbers without quotes.
(5) Do not include any additional information, explaination or context in the response.
(6) If you are unsure about a specific category, you can leave it as an empty string.
(7) The output must be a valid JSON object that can be directly loaded by json.loads. Example response for Year column with sample values like 2018, 2020, 2023 is
```
{example}
```

Column name: {column_name}
Sample values: {sample_values}
"""
        
        # LLAMA3 chat format
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]
        
        prompt = self.tokenizer.apply_chat_template(
            messages, 
            tokenize=False, 
            add_generation_prompt=True
        )
        
        return prompt
    
    def generate_semantic_profile(self, column_name: str, sample_values: List[Any], max_new_tokens: int = 2048) -> str:
        """Generate Semantic Profile from column name and samples"""
        
        # Create prompt
        prompt = self.create_semantic_profile_prompt(column_name, sample_values)
        
        # Tokenize
        inputs = self.tokenizer(
            prompt, 
            return_tensors="pt", 
            truncation=True, 
            max_length=2048,
        )
        inputs = {k: v.to(self.model.device) for k, v in inputs.items()}
        
        # Generate response
        with torch.no_grad():
            outputs = self.model.generate(
                **inputs,
                max_new_tokens=max_new_tokens,
                temperature=0.5,
                pad_token_id=self.tokenizer.eos_token_id,
                eos_token_id=self.tokenizer.eos_token_id,
            )
        
        # Decode prompt and response with same settings
        prompt_decoded = self.tokenizer.decode(inputs['input_ids'][0], skip_special_tokens=True)
        full_response = self.tokenizer.decode(outputs[0], skip_special_tokens=True)
        
        # Split prompt base on length of the decoded prompt
        if full_response.startswith(prompt_decoded):
            response = full_response[len(prompt_decoded):].strip()
        # Clean response
        response = self.clean_response(response)
        
        return response
    
    def clean_response(self, response: str) -> str:
        """Clean and normalize the response"""
        
        # # Take only the first line
        # response = response.split('\n')[0].strip()
        
        # Remove extra punctuation
        response = re.sub(r'[.!?]+$', '', response)
        
        # Remove extra whitespace
        response = re.sub(r'\s+', ' ', response).strip()
        
        # Remove common unwanted prefixes
        unwanted_prefixes = ['Column Name:', 'Samples Values:', 'Result:', 'json '"Dataset description overview:"]
        for prefix in unwanted_prefixes:
            if response.startswith(prefix):
                response = response[len(prefix):].strip()
        
        return response

    def create_dataset_topic_generation_prompt(self, title: str, original_description: str = "", dataset_sample: str = "") -> str:
        """Create optimized prompt for generate dataset topic"""
        
        system_prompt = "You are an assistant for generating concise dataset topics."
        
        user_prompt = f"""Using the dataset information provided, generate a concise topic in 2-3 words that best describes the dataset’s primary theme without explaination:
- Title: {title}
- Original Description: {original_description} (optional)
- Dataset Sample: {dataset_sample}
- Topic (2-3 words):"""
        
        # LLAMA3 chat format
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]
        
        prompt = self.tokenizer.apply_chat_template(
            messages, 
            tokenize=False, 
            add_generation_prompt=True
        )
        
        return prompt
    
    def generate_dataset_topic(self, title: str, original_description: str = "", dataset_sample: str = "", max_new_tokens: int = 4096) -> str:
        """Generate dataset topic"""
        
        # Create prompt
        prompt = self.create_dataset_topic_generation_prompt(title, original_description, dataset_sample)
        
        # Tokenize
        inputs = self.tokenizer(
            prompt, 
            return_tensors="pt", 
            truncation=True, 
            max_length=2048,
            # padding=True
        )
        inputs = {k: v.to(self.model.device) for k, v in inputs.items()}
        
        # Generate response
        with torch.no_grad():
            outputs = self.model.generate(
                **inputs,
                max_new_tokens=max_new_tokens,
                temperature=0.7,
                do_sample=True,
                pad_token_id=self.tokenizer.eos_token_id,
                eos_token_id=self.tokenizer.eos_token_id,
            )
        
        # Decode prompt and response with same settings
        prompt_decoded = self.tokenizer.decode(inputs['input_ids'][0], skip_special_tokens=True)
        full_response = self.tokenizer.decode(outputs[0], skip_special_tokens=True)
        # Split prompt base on length of the decoded prompt
        if full_response.startswith(prompt_decoded):
            response = full_response[len(prompt_decoded):].strip()
        # Clean response
        response = self.clean_response(response)
        return response

    def create_user_focused_description_prompt(self, dataset_sample: str, dataset_profile: str, semantic_profile: str, data_topic: str) -> str:
        """Create prompt for search focused description"""
            
        system_prompt = "You are an assistant for a dataset search engine. Your goal is to improve the readability of dataset descriptions for dataset search engine users."
            
        user_prompt = f"""
Answer the question using the following information.
First, consider the dataset sample:
{dataset_sample}
Additionally, the dataset profile is as follows:
{dataset_profile}
Based on this profile, please add sentence(s) to enrich the dataset description.
Furthermore, the semantic profile of the dataset columns is as follows:
{semantic_profile}
Based on this information, please add sentence(s) discussing the semantic profile in the description.
Moreover, the dataset topic is: {data_topic}. Based on this topic, please add sentence(s) describing what this dataset can be used for.
Question: Based on the information above and the requirements, provide a dataset description in sentences. Use only natural, readable sentences without special formatting, do not include any additional information or context in the response and must start with "Dataset description overview:".
Answer:
"""
            
        # LLAMA3 chat format
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]
        
        prompt = self.tokenizer.apply_chat_template(
            messages, 
            tokenize=False, 
            add_generation_prompt=True
        )
        
        return prompt
        
    def generate_user_focused_description(self, dataset_sample: str, dataset_profile: str, semantic_profile: str, data_topic: str, max_new_tokens: int = 4096) -> str:
        """Extract information from a single question"""
        
        # Create prompt
        prompt = self.create_user_focused_description_prompt(dataset_sample, dataset_profile, semantic_profile, data_topic)
        
        # Tokenize
        inputs = self.tokenizer(
            prompt, 
            return_tensors="pt", 
            truncation=True, 
            max_length=8192,
        )
        inputs = {k: v.to(self.model.device) for k, v in inputs.items()}
        
        # Generate response
        with torch.no_grad():
            outputs = self.model.generate(
                **inputs,
                max_new_tokens=max_new_tokens,
                temperature=0.7,
                do_sample=True,
                pad_token_id=self.tokenizer.eos_token_id,
                eos_token_id=self.tokenizer.eos_token_id,
            )
        
        # Decode prompt and response with same settings
        prompt_decoded = self.tokenizer.decode(inputs['input_ids'][0], skip_special_tokens=True)
        full_response = self.tokenizer.decode(outputs[0], skip_special_tokens=True)
        # Split prompt base on length of the decoded prompt
        if full_response.startswith(prompt_decoded):
            response = full_response[len(prompt_decoded):].strip()
        # Clean response
        response = self.clean_response(response)

        return response

    def create_search_focused_description_prompt(self, topic: str, initial_description: str) -> str:
        """Create prompt for search focused description"""
        
        system_prompt = "You are an assistant for a dataset search engine. Your goal is to improve the performance of the dataset search engine for keyword queries."
        
        user_prompt = f"""
You are given a dataset about the topic {topic}, with the following initial description:
{initial_description}
Please expand the description by including the exact topic. Additionally, add as many related concepts, synonyms, and relevant terms as possible based on the initial description and the topic.
Unlike the initial description, which is focused on presentation and readability, the expanded description is intended to be indexed at the backend of a dataset search engine to improve searchability.
Therefore, focus less on readability and more on including all relevant terms related to the topic. Make sure to include any variations of the key terms and concepts that could help improve retrieval in search results.
Please follow the structure of the following example template:
Dataset Overview:
- Please keep the exact initial description of the dataset as shown in beginning the prompt.

Key Themes or Topics:
- Central focus on a broad area of interest (e.g., urban planning, socio-economic factors, environmental analysis).
- Data spans multiple subtopics or related areas that contribute to a holistic understanding of the primary theme.
Example:
- theme1/topic1
- theme2/topic2
- theme3/topic3

Applications and Use Cases:
- Facilitates analysis for professionals, policymakers, researchers, or stakeholders.
- Useful for specific applications, such as planning, engineering, policy formulation, or statistical modeling.
- Enables insights into patterns, trends, and relationships relevant to the domain.
Example:
- application1/usecase1
- application2/usecase2
- application3/usecase3

Concepts and Synonyms:
- Includes related concepts, terms, and variations to ensure comprehensive coverage of the topic.
- Synonyms and alternative phrases improve searchability and retrieval effectiveness.
Example:
- concept1/synonym1
- concept2/synonym2
- concept3/synonym3

Keywords and Themes:
- Lists relevant keywords and themes for indexing, categorization, and enhancing discoverability.
- Keywords reflect the dataset's content, scope, and relevance to the domain.
Example:
- keyword1
- keyword2
- keyword3

Additional Context:
- Highlights the dataset's relevance to specific challenges or questions in the domain.
- May emphasize its value for interdisciplinary applications or integration with related datasets.
Example:
- context1
- context2
- context3
"""
        
        # LLAMA3 chat format
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]
        
        prompt = self.tokenizer.apply_chat_template(
            messages, 
            tokenize=False, 
            add_generation_prompt=True
        )
        
        return prompt
    
    def generate_search_focused_description(self, topic: str, initial_description: str, max_new_tokens: int = 4096) -> str:
        """Extract information from a single question"""
        
        # Create prompt
        prompt = self.create_search_focused_description_prompt(topic, initial_description)
        
        # Tokenize
        inputs = self.tokenizer(
            prompt, 
            return_tensors="pt", 
            truncation=True, 
            max_length=8192,
        )
        inputs = {k: v.to(self.model.device) for k, v in inputs.items()}
        
        # Generate response
        with torch.no_grad():
            outputs = self.model.generate(
                **inputs,
                max_new_tokens=max_new_tokens,
                temperature=0.7,
                do_sample=True,
                pad_token_id=self.tokenizer.eos_token_id,
                eos_token_id=self.tokenizer.eos_token_id,
            )
        
        # Decode prompt and response with same settings
        prompt_decoded = self.tokenizer.decode(inputs['input_ids'][0], skip_special_tokens=True)
        full_response = self.tokenizer.decode(outputs[0], skip_special_tokens=True)
        
        # Split prompt base on length of the decoded prompt
        if full_response.startswith(prompt_decoded):
            response = full_response[len(prompt_decoded):].strip()
        # Clean response
        response = self.clean_response(response)

        return response


print("LLM class defined successfully!")
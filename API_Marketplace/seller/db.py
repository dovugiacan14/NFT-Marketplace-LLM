from langchain_community.embeddings import HuggingFaceEmbeddings
import os

embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")

import faiss
from langchain_community.vectorstores import FAISS
from langchain_community.docstore.in_memory import InMemoryDocstore

FAISS_FOLDER = "faiss_index"

class FaissDB:
    def __init__(self):
        index_path = os.path.join(FAISS_FOLDER, "index.faiss")
        pkl_path = os.path.join(FAISS_FOLDER, "index.pkl")

        if os.path.exists(index_path) and os.path.exists(pkl_path):
            print("Loading FAISS index from local...")
            self.vector_store = FAISS.load_local(
                folder_path=FAISS_FOLDER,
                embeddings=embeddings,
                allow_dangerous_deserialization=True
            )

        else:
            print("FAISS not found locally -> creating new...")

            # Get dimension from embed model
            dimension = len(embeddings.embed_query("hello world"))

            # Create FAISS index
            index = faiss.IndexFlatL2(dimension)

            # Create new vector store
            self.vector_store = FAISS(
                embedding_function=embeddings,
                index=index,
                docstore=InMemoryDocstore(),
                index_to_docstore_id={}
            )
            os.makedirs(FAISS_FOLDER, exist_ok=True)
            self.vector_store.save_local(FAISS_FOLDER)

    def add_text(self, cid: str, text: str, title: str = "", image_cid: str = ""):
        # Remove existing entry if exists (upsert behavior)
        if cid in self.vector_store.index_to_docstore_id.values():
            self.delete_by_cid(cid)
        metadata = {
            "cid": cid,
            "title": title,
            "image_cid": image_cid,
        }
        self.vector_store.add_texts([text], [metadata], ids=[cid])

    def delete_by_cid(self, cid: str):
        """Delete document by cid from vector store."""
        self.vector_store.delete([cid])

    def search(self, query: str, k: int = 5):
        return self.vector_store.similarity_search_with_score(query, k)

    def save(self):
        self.vector_store.save_local(FAISS_FOLDER)

    def close(self):
        self.vector_store.close()
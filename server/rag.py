from llama_index.core import VectorStoreIndex, Settings
from llama_index.vector_stores.chroma import ChromaVectorStore
from llama_index.embeddings.huggingface import HuggingFaceEmbedding
import chromadb


# 🔑 CRITICAL: set embed model AGAIN for query-time
Settings.embed_model = HuggingFaceEmbedding(
    model_name="BAAI/bge-base-en-v1.5"
)

# Optional but safe
Settings.llm = None  # or your local LLM if you have one


def load_index():
    client = chromadb.PersistentClient(path="storage")
    collection = client.get_collection("rag_demo")

    vector_store = ChromaVectorStore(
        chroma_collection=collection
    )

    return VectorStoreIndex.from_vector_store(
        vector_store
    )


async def query_rag(question: str) -> str:
    index = load_index()

    query_engine = index.as_query_engine(
        similarity_top_k=5
    )

    response = await query_engine.aquery(question)
    return str(response)

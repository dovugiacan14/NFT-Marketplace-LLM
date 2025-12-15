import pickle
import faiss
from seller.db import FaissDB

# Load pkl file to see documents
with open('faiss_index/index.pkl', 'rb') as f:
    data = pickle.load(f)

print('Type:', type(data))

if isinstance(data, dict):
    print('Keys:', list(data.keys()))
    for k, v in data.items():
        print(f'  {k}: {type(v)} - {len(v) if hasattr(v, "__len__") else v}')
elif isinstance(data, tuple):
    print('Tuple length:', len(data))
    for i, item in enumerate(data):
        print(f'  [{i}]: {type(item)} - {len(item) if hasattr(item, "__len__") else item}')
        if hasattr(item, '__iter__') and not isinstance(item, str) and len(item) < 10:
            for j, sub in enumerate(item):
                print(f'      [{j}]: {sub}')

# Load faiss index
index = faiss.read_index('faiss_index/index.faiss')
print(f'\nFAISS index:')
print(f'  Total vectors: {index.ntotal}')
print(f'  Dimension: {index.d}')

# Test search
print('\n--- Test Search ---')
db = FaissDB()
results = db.search("movie film entertainment", k=3)
print(f'Found {len(results)} results:')
for doc, score in results:
    print(f'  CID: {doc.metadata.get("cid", "N/A")}')
    print(f'  Score: {score}')
    print(f'  Content: {doc.page_content[:200]}...')
    print()

import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { ethers } from 'ethers'
import axios from 'axios'
import Link from 'next/link'
import Spinner from '../components/Spinner'

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const nftmarketaddress = process.env.NEXT_PUBLIC_NFTMARKET_ADDRESS

import Market from '../artifacts/contracts/NFTMarket.sol/NFTMarket.json'

export default function SearchPage() {
  const router = useRouter()
  const { q } = router.query

  const [searchQuery, setSearchQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [marketItems, setMarketItems] = useState({})

  useEffect(() => {
    if (q) {
      setSearchQuery(q)
      searchDatasets(q)
    }
  }, [q])

  async function searchDatasets(query) {
    if (!query.trim()) return

    setLoading(true)
    setSearched(true)

    try {
      const res = await axios.post(`${apiUrl}/search`, {
        query: query.trim(),
        top_k: 20
      })

      setResults(res.data)

      // Try to fetch matching market items
      await fetchMarketItems(res.data)
    } catch (err) {
      console.error("Search error:", err)
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  async function fetchMarketItems(searchResults) {
    try {
      const provider = new ethers.providers.JsonRpcProvider(process.env.NEXT_PUBLIC_ETH_NETWORK)
      const marketContract = new ethers.Contract(nftmarketaddress, Market.abi, provider)

      const items = await marketContract.fetchMarketItems()

      // Create a map of CID to market item
      const itemMap = {}
      for (const item of items) {
        // The item might have encryptedDataUrl that contains CID
        if (item.encryptedDataUrl) {
          const cid = extractCidFromUrl(item.encryptedDataUrl)
          if (cid) {
            itemMap[cid] = {
              itemId: item.itemId.toNumber(),
              price: ethers.utils.formatEther(item.price),
              seller: item.seller,
              licenseType: item.licenseType || 'personal'
            }
          }
        }
      }

      setMarketItems(itemMap)
    } catch (err) {
      console.error("Error fetching market items:", err)
    }
  }

  function extractCidFromUrl(url) {
    if (!url) return null
    const match = url.match(/ipfs\/([a-zA-Z0-9]+)/)
    return match ? match[1] : null
  }

  const handleSearch = (e) => {
    e.preventDefault()
    if (searchQuery.trim()) {
      router.push(`/search?q=${encodeURIComponent(searchQuery.trim())}`, undefined, { shallow: true })
      searchDatasets(searchQuery)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Search Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-4">Search Datasets</h1>
          <p className="text-gray-600 mb-6">
            Find datasets using AI-powered semantic search
          </p>

          {/* Search Form */}
          <form onSubmit={handleSearch} className="flex gap-4">
            <div className="flex-1 relative">
              <input
                type="text"
                placeholder="Search for datasets (e.g., financial data, weather records, user analytics...)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-3 pl-12 text-gray-700 bg-white border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm"
              />
              <svg
                className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <button
              type="submit"
              disabled={loading || !searchQuery.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 py-3 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {loading ? (
                <>
                  <Spinner size="sm" color="white" />
                  <span>Searching...</span>
                </>
              ) : (
                'Search'
              )}
            </button>
          </form>
        </div>

        {/* Results Section */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Spinner size="lg" color="blue" />
            <p className="mt-4 text-gray-600">Searching datasets...</p>
          </div>
        ) : searched ? (
          results.length > 0 ? (
            <div>
              <p className="text-gray-600 mb-6">
                Found {results.length} result{results.length !== 1 ? 's' : ''} for "{q}"
              </p>

              <div className="space-y-4">
                {results.map((result, index) => {
                  const marketItem = marketItems[result.cid]

                  return (
                    <div
                      key={index}
                      className="bg-white rounded-xl shadow-md p-6 hover:shadow-lg transition-shadow border border-gray-100"
                    >
                      <div className="flex gap-4">
                        {/* Image */}
                        {result.image_cid && (
                          <div className="flex-shrink-0">
                            <img
                              src={`https://${process.env.NEXT_PUBLIC_PINATA_GATEWAY_URL}/ipfs/${result.image_cid}`}
                              alt={result.title}
                              className="w-24 h-24 object-cover rounded-lg"
                              onError={(e) => {
                                e.target.style.display = 'none'
                              }}
                            />
                          </div>
                        )}

                        <div className="flex-1 flex justify-between items-start">
                          <div className="flex-1">
                            {/* Title */}
                            <h3 className="text-xl font-bold text-gray-800 mb-2">
                              {result.title || 'Untitled Dataset'}
                            </h3>

                            {/* Score Badge */}
                            <div className="flex items-center gap-3 mb-3">
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                Relevance: {((1 - result.score) * 100).toFixed(0)}%
                              </span>
                              {marketItem && (
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                  Available for Purchase
                                </span>
                              )}
                            </div>

                            {/* Content */}
                            <p className="text-gray-600 mb-3 line-clamp-2 text-sm">
                              {result.content}
                            </p>

                            {/* CID */}
                            <p className="text-xs text-gray-400 font-mono">
                              ID: {result.cid.slice(0, 16)}...
                            </p>
                          </div>

                          {/* Price & Actions */}
                          {marketItem && (
                            <div className="ml-6 text-right">
                              <p className="text-2xl font-bold text-gray-800">
                                {marketItem.price} ETH
                              </p>
                              <p className="text-sm text-gray-500 mb-3">
                                License: {marketItem.licenseType}
                              </p>
                              <Link href={`/nft/${marketItem.itemId}`}>
                                <button className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-2 rounded-lg transition-colors">
                                  View Details
                                </button>
                              </Link>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="text-center py-20">
              <svg
                className="w-16 h-16 text-gray-300 mx-auto mb-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <h3 className="text-xl font-medium text-gray-600 mb-2">No results found</h3>
              <p className="text-gray-500">
                Try different keywords or check your spelling
              </p>
            </div>
          )
        ) : (
          <div className="text-center py-20">
            <svg
              className="w-20 h-20 text-gray-300 mx-auto mb-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <h3 className="text-xl font-medium text-gray-600 mb-2">Search for datasets</h3>
            <p className="text-gray-500">
              Enter keywords to find relevant datasets using AI-powered semantic search
            </p>

            {/* Popular Searches */}
            <div className="mt-8">
              <p className="text-sm text-gray-500 mb-3">Popular searches:</p>
              <div className="flex flex-wrap justify-center gap-2">
                {['financial data', 'weather records', 'user analytics', 'sales data', 'medical records'].map((term) => (
                  <button
                    key={term}
                    onClick={() => {
                      setSearchQuery(term)
                      router.push(`/search?q=${encodeURIComponent(term)}`)
                    }}
                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-full text-sm transition-colors"
                  >
                    {term}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

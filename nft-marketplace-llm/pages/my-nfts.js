import { ethers } from 'ethers'
import { useEffect, useState } from 'react'
import web3 from 'web3'
import axios from 'axios'
import Web3Modal from "web3modal"
import Link from 'next/link'
import { convert_src } from '../utils/utils'
import Loading from '../components/Loading'

import Market from '../artifacts/contracts/NFTMarket.sol/NFTMarket.json'
import NFT from '../artifacts/contracts/NFT.sol/NFT.json'

const nftaddress = process.env.NEXT_PUBLIC_NFT_ADDRESS;
const nftmarketaddress = process.env.NEXT_PUBLIC_NFTMARKET_ADDRESS;

export default function Home() {
  const [nfts, setNfts] = useState([])
  const [loaded, setLoaded] = useState('not-loaded')

  useEffect(() => {
    loadNFTs()
  }, [])

  // load the NFTs users have purchased
  async function loadNFTs() {
    setLoaded('loading')
    const web3Modal = new Web3Modal({
      network: "mainnet",
      cacheProvider: true,
    });
    const connection = await web3Modal.connect()
    const provider = new ethers.providers.Web3Provider(connection)
    const signer = provider.getSigner()

    const marketContract = new ethers.Contract(nftmarketaddress, Market.abi, signer)
    const tokenContract = new ethers.Contract(nftaddress, NFT.abi, provider)
    // give users the ability to view the NFTs they have purchased
    const data = await marketContract.fetchMyNFTs()
    console.log(data)
    const items = await Promise.all(data.map(async i => {
      const tokenUri = await tokenContract.tokenURI(i.tokenId)
      const meta = await axios.get(convert_src(tokenUri))
      console.log(i.tokenId.toString())
      let price = web3.utils.fromWei(i.price.toString(), 'ether');
      let item = {
        price,
        tokenId: i.tokenId.toNumber(),
        seller: i.seller,
        owner: i.owner,
        name: meta.data.name,
        description: meta.data.description,
        image: convert_src(meta.data.image),
      }
      return item
    }))
    console.log('items: ', items)
    setNfts(items)
    setLoaded('loaded')
  }

  if (loaded === 'loading') return <Loading message="Loading your NFTs..." />
  if (loaded === 'loaded' && !nfts.length) return (<h1 className="p-20 text-4xl">No NFTs!</h1>)

  // Color palette for card backgrounds
  const cardColors = ['#F4ECC2', '#E8F5E9', '#FFF9C4', '#FFE0E0'];

  return (
    <div className="flex justify-center px-4">
      <div className="w-full max-w-7xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 pt-8 pb-8">
          {
            nfts.map((nft, i) => (
              <div
                key={i}
                className="rounded-3xl overflow-hidden shadow-lg hover:shadow-2xl transition-shadow duration-300"
                style={{ backgroundColor: cardColors[i % cardColors.length] }}
              >
                {/* Card Header with Icons */}
                <div className="relative p-4">
                  {/* Image Icon */}
                  <div className="absolute top-6 left-6 bg-gray-700 bg-opacity-60 rounded-full p-2">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>

                  {/* Heart Icon */}
                  <div className="absolute top-6 right-6 bg-white rounded-full p-2 cursor-pointer hover:bg-gray-100">
                    <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                    </svg>
                  </div>

                  {/* NFT Image */}
                  <Link href={`/nft/${nft.tokenId}`}>
                    <img
                      src={nft.image}
                      className="rounded-2xl w-full h-64 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                      alt={`NFT #${nft.tokenId}`}
                    />
                  </Link>
                </div>

                {/* Card Body */}
                <div className="px-4 pb-4">
                  {/* Avatar Icons */}
                  <div className="flex items-center mb-3 -mt-2">
                    <div className="flex -space-x-2">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-400 to-pink-400 border-2 border-white"></div>
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-cyan-400 border-2 border-white"></div>
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-yellow-400 to-orange-400 border-2 border-white"></div>
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-400 to-teal-400 border-2 border-white"></div>
                    </div>
                    <span className="ml-3 text-sm text-gray-600 font-medium">99 in stock</span>
                  </div>

                  {/* NFT Title */}
                  <h3 className="text-lg font-bold text-gray-800 mb-3">
                    {nft.name}
                  </h3>

                  {/* Price and Time Section */}
                  <div className="flex items-center justify-between">
                    {/* Price Paid */}
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Price Paid</p>
                      <div className="inline-block border-2 border-green-500 rounded-lg px-3 py-1">
                        <p className="text-sm font-bold text-gray-800">{nft.price} ETH</p>
                      </div>
                    </div>

                    {/* Owned Badge */}
                    <div className="text-right">
                      <span className="inline-block bg-blue-500 text-white text-xs font-semibold px-3 py-1 rounded-full">
                        Owned
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  )
}

// SPDX-License-Identifier: MIT OR Apache-2.0
pragma solidity ^0.8.3;

import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

import "hardhat/console.sol";

// Inheriting from ReentrancyGuard will make the nonReentrant modifier available, 
// which can be applied to functions to make sure there are 
// no nested (reentrant) calls to them.

contract NFTMarket is ReentrancyGuard {
  using Counters for Counters.Counter;
  Counters.Counter private _itemIds;
  Counters.Counter private _itemsSold;

  address payable owner;
  uint256 listingPrice = 0.1 ether;

  constructor() {
    owner = payable(msg.sender);
  }

// store records of items that we want to make available in the marketplace
  struct MarketItem {
    uint itemId;
    address nftContract;
    uint256 tokenId;
    address payable seller;
    address payable owner;
    uint256 price;
    bytes32 dataHash;           // SHA256 hash of original data for integrity verification
    string licenseType;         // "commercial", "research", "personal"
    string encryptedDataUrl;    // IPFS URL to encrypted data file
  }
// key value pairing between IDs and MarketItems
  mapping(uint256 => MarketItem) private idToMarketItem;

  event MarketItemCreated (
    uint indexed itemId,
    address indexed nftContract,
    uint256 indexed tokenId,
    address seller,
    address owner,
    uint256 price,
    bytes32 dataHash,
    string licenseType,
    string encryptedDataUrl
  );


  event MarketItemSold(
    uint indexed itemId,
    address indexed nftContract,
    uint256 indexed tokenId,
    address seller,
    address buyer,
    uint256 price,
    uint256 timestamp
  );

    event MarketItemRelisted(
    uint indexed itemId,
    address indexed nftContract,
    uint256 indexed tokenId,
    address seller,
    uint256 price,
    uint256 timestamp
  );

  event MarketItemCanceled(
    uint indexed itemId,
    address indexed nftContract,
    uint256 indexed tokenId,
    address seller,
    uint256 timestamp
  );

  function getMarketItem(uint256 marketItemId) public view returns (MarketItem memory) {
    return idToMarketItem[marketItemId];
  }

// transfers an NFT to the contract address of the market, and puts the item for sale
  function createMarketItem(
    address nftContract,
    uint256 tokenId,
    uint256 price,
    bytes32 dataHash,
    string memory licenseType,
    string memory encryptedDataUrl
  ) public payable nonReentrant {
    require(price > 0, "Price must be at least 1 wei");
    require(msg.value == listingPrice, "Price must be equal to listing price");

    _itemIds.increment();
    uint256 itemId = _itemIds.current();

    idToMarketItem[itemId] =  MarketItem(
      itemId,
      nftContract,
      tokenId,
      payable(msg.sender),
      payable(address(0)),
      price,
      dataHash,
      licenseType,
      encryptedDataUrl
    );

    IERC721(nftContract).transferFrom(msg.sender, address(this), tokenId);

    emit MarketItemCreated(
      itemId,
      nftContract,
      tokenId,
      msg.sender,
      address(0),
      price,
      dataHash,
      licenseType,
      encryptedDataUrl
    );
  }

// enables the transfer of the NFT as well as ETH between the buyer and seller
  function createMarketSale(
    address nftContract,
    uint256 itemId
    ) public payable nonReentrant {
    uint price = idToMarketItem[itemId].price;
    uint tokenId = idToMarketItem[itemId].tokenId;
    require(msg.value == price, "Please submit the asking price in order to complete the purchase");

    idToMarketItem[itemId].seller.transfer(msg.value);
    IERC721(nftContract).transferFrom(address(this), msg.sender, tokenId);
    idToMarketItem[itemId].owner = payable(msg.sender);
    _itemsSold.increment();
    payable(owner).transfer(listingPrice);

    emit MarketItemSold(
      itemId,
      nftContract,
      tokenId,
      idToMarketItem[itemId].seller,
      msg.sender,
      price,
      block.timestamp
    );

  }

  // relist by owner
  function relistMarketItem(uint256 itemId, uint256 price) public payable nonReentrant {
      MarketItem storage item = idToMarketItem[itemId];

      // Kiểm tra người gọi là chủ sở hữu
      require(item.owner == msg.sender, "Only owner can relist");
      // Giá phải lớn hơn 0
      require(price > 0, "Price must be > 0");
      // Phải trả đúng listing fee
      require(msg.value == listingPrice, "Must pay listing fee");

      // Transfer NFT từ owner về contract
      IERC721(item.nftContract).transferFrom(msg.sender, address(this), item.tokenId);

      // Cập nhật trạng thái item
      item.seller = payable(msg.sender);
      item.owner = payable(address(0)); // đánh dấu item chưa bán
      item.price = price;

      // Giảm số lượng item đã bán để fetchMarketItems() tính đúng
      _itemsSold.decrement();

      // Emit sự kiện để frontend theo dõi
      emit MarketItemRelisted(
          itemId,
          item.nftContract,
          item.tokenId,
          msg.sender,
          price,
          block.timestamp
      );
  }


  // cancel listing
  function cancelListing(uint256 itemId) public nonReentrant {
    MarketItem storage item = idToMarketItem[itemId];
    require(item.owner == address(0), "Can't cancel after sold");
    require(item.seller == msg.sender, "Only seller can cancel");

    IERC721(item.nftContract).transferFrom(address(this), msg.sender, item.tokenId);

    emit MarketItemCanceled(
      itemId,
      item.nftContract,
      item.tokenId,
      msg.sender,
      block.timestamp
    );

    item.owner = payable(item.seller);
  }
  
  function fetchMarketItem(uint itemId) public view returns (MarketItem memory) {
    MarketItem memory item = idToMarketItem[itemId];
    return item;
  }

function fetchMarketItems() public view returns (MarketItem[] memory) {
    uint itemCount = _itemIds.current();
    uint unsoldCount = 0;

    // Đếm số item chưa bán thực tế
    for (uint i = 1; i <= itemCount; i++) {
        MarketItem storage currentItem = idToMarketItem[i];
        if (currentItem.owner == address(0) && currentItem.itemId != 0) {
            unsoldCount++;
        }
    }

    // Tạo mảng vừa đủ size
    MarketItem[] memory items = new MarketItem[](unsoldCount);
    uint currentIndex = 0;

    for (uint i = 1; i <= itemCount; i++) {
        MarketItem storage currentItem = idToMarketItem[i];
        if (currentItem.owner == address(0) && currentItem.itemId != 0) {
            items[currentIndex] = currentItem;
            currentIndex++;
        }
    }

    return items;
}



// returns the NFTs that the user has purchased
  function fetchMyNFTs() public view returns (MarketItem[] memory) {
    uint totalItemCount = _itemIds.current();
    uint itemCount = 0;
    uint currentIndex = 0;

    for (uint i = 0; i < totalItemCount; i++) {
      if (idToMarketItem[i + 1].owner == msg.sender) {
        itemCount += 1;
      }
    }

    MarketItem[] memory items = new MarketItem[](itemCount);
    for (uint i = 0; i < totalItemCount; i++) {
      if (idToMarketItem[i + 1].owner == msg.sender) {
        uint currentId = idToMarketItem[i + 1].itemId;
        MarketItem storage currentItem = idToMarketItem[currentId];
        items[currentIndex] = currentItem;
        currentIndex += 1;
      }
    }

    return items;
  }

  // ==================== DATA MARKETPLACE FUNCTIONS ====================

  // Get data info for a market item
  function getDataInfo(uint256 itemId) public view returns (
    bytes32 dataHash,
    string memory licenseType,
    string memory encryptedDataUrl
  ) {
    MarketItem storage item = idToMarketItem[itemId];
    return (item.dataHash, item.licenseType, item.encryptedDataUrl);
  }

  // Verify if an address owns a specific item
  function verifyOwnership(uint256 itemId, address user) public view returns (bool) {
    return idToMarketItem[itemId].owner == user;
  }

  // Get listing price
  function getListingPrice() public view returns (uint256) {
    return listingPrice;
  }
}
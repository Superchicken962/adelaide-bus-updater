-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Generation Time: Oct 14, 2024 at 01:10 PM
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `adelaide_bus_tracker`
--

-- --------------------------------------------------------

--
-- Table structure for table `firstseen`
--

CREATE TABLE `firstseen` (
  `vehicleId` varchar(255) NOT NULL,
  `vehicleType` varchar(15) NOT NULL,
  `tripId` varchar(50) NOT NULL,
  `route` varchar(50) NOT NULL,
  `headsign` varchar(255) NOT NULL,
  `routeColour` varchar(50) DEFAULT NULL,
  `routeTextColour` varchar(50) DEFAULT NULL,
  `latitude` float NOT NULL,
  `longitude` float NOT NULL,
  `timestamp` varchar(50) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `lastseen`
--

CREATE TABLE `lastseen` (
  `id` int(11) NOT NULL,
  `tripId` varchar(50) NOT NULL,
  `route` varchar(20) NOT NULL,
  `routeColour` varchar(50) DEFAULT NULL,
  `routeTextColour` varchar(50) DEFAULT NULL,
  `timestamp` varchar(100) NOT NULL,
  `latitude` float NOT NULL,
  `longitude` float NOT NULL,
  `bearing` float NOT NULL,
  `speed` double NOT NULL,
  `vehicleId` varchar(255) NOT NULL,
  `vehicleType` varchar(15) NOT NULL,
  `routeStartTime` text DEFAULT NULL,
  `routeEndTime` text DEFAULT NULL,
  `updateTime` text NOT NULL,
  `startTime` text NOT NULL,
  `shapeId` text NOT NULL,
  `destination` text NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `stops`
--

CREATE TABLE `stops` (
  `id` varchar(255) NOT NULL,
  `code` text NOT NULL,
  `name` text NOT NULL,
  `description` text NOT NULL,
  `latitude` text NOT NULL,
  `longitude` text NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `trips`
--

CREATE TABLE `trips` (
  `id` varchar(50) NOT NULL,
  `headsign` varchar(255) NOT NULL,
  `startTime` varchar(50) NOT NULL,
  `endTime` varchar(50) NOT NULL,
  `route` varchar(20) NOT NULL,
  `updateTimestamp` varchar(100) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `tripvehicles`
--

CREATE TABLE `tripvehicles` (
  `tripId` varchar(50) NOT NULL,
  `vehicleId` varchar(255) NOT NULL,
  `vehicleType` varchar(15) NOT NULL,
  `timestamp` text NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `vehicles`
--

CREATE TABLE `vehicles` (
  `id` varchar(255) NOT NULL,
  `type` varchar(15) NOT NULL,
  `chassis` text NOT NULL,
  `body` text NOT NULL,
  `livery` text NOT NULL,
  `operator` text NOT NULL,
  `lastseenId` int(11) NOT NULL,
  `firstseenid` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Indexes for dumped tables
--

--
-- Indexes for table `firstseen`
--
ALTER TABLE `firstseen`
  ADD PRIMARY KEY (`vehicleId`,`vehicleType`);

--
-- Indexes for table `lastseen`
--
ALTER TABLE `lastseen`
  ADD PRIMARY KEY (`tripId`,`vehicleId`,`vehicleType`),
  ADD UNIQUE KEY `id` (`id`);

--
-- Indexes for table `stops`
--
ALTER TABLE `stops`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `trips`
--
ALTER TABLE `trips`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `tripvehicles`
--
ALTER TABLE `tripvehicles`
  ADD PRIMARY KEY (`tripId`,`vehicleId`,`vehicleType`);

--
-- Indexes for table `vehicles`
--
ALTER TABLE `vehicles`
  ADD PRIMARY KEY (`id`,`type`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `lastseen`
--
ALTER TABLE `lastseen`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- Constraints for dumped tables
--

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;

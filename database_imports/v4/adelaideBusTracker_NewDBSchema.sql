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
-- Database: `adelaide_bus_site_new`
--

-- --------------------------------------------------------

--
-- Table structure for table `contributorapplications`
--

CREATE TABLE `contributorapplications` (
  `id` int(11) NOT NULL,
  `authorId` varchar(255) NOT NULL,
  `authorName` varchar(100) NOT NULL,
  `authorEmail` varchar(100) NOT NULL,
  `notifyIfSuccessful` tinyint(1) NOT NULL,
  `question_why` text NOT NULL,
  `question_knowledge` text NOT NULL,
  `submission_date` varchar(50) NOT NULL,
  `status` varchar(20) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `favouritestops`
--

CREATE TABLE `favouritestops` (
  `userId` varchar(255) NOT NULL,
  `stopId` varchar(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `favouritevehicles`
--

CREATE TABLE `favouritevehicles` (
  `userId` varchar(255) NOT NULL,
  `vehicleId` int(11) NOT NULL,
  `vehicleType` varchar(15) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

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
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `id` varchar(255) NOT NULL,
  `name` text NOT NULL,
  `email` text NOT NULL,
  `password` text NOT NULL,
  `registerDate` text NOT NULL,
  `isAdmin` tinyint(1) NOT NULL,
  `isContributor` tinyint(1) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `usertokens`
--

CREATE TABLE `usertokens` (
  `userId` varchar(255) NOT NULL,
  `token` varchar(255) NOT NULL,
  `creation_date` date NOT NULL,
  `last_used` date NOT NULL
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
-- Table structure for table `vehiclesoutofservice`
--

CREATE TABLE `vehiclesoutofservice` (
  `type` text NOT NULL,
  `id` text NOT NULL,
  `hide` tinyint(1) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `vehiclesoutofservice`
--

INSERT INTO `vehiclesoutofservice` (`type`, `id`, `hide`) VALUES
('bus', '240', 0),
('bus', '241', 0),
('bus', '246', 0),
('bus', '247', 0),
('bus', '266', 0),
('bus', '267', 0),
('bus', '2205', 0),
('bus', '3269', 0),
('bus', '3270', 0),
('bus', '3310', 0),
('bus', '3311', 0);

--
-- Indexes for dumped tables
--

--
-- Indexes for table `contributorapplications`
--
ALTER TABLE `contributorapplications`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `authorId` (`authorId`);

--
-- Indexes for table `favouritestops`
--
ALTER TABLE `favouritestops`
  ADD PRIMARY KEY (`userId`,`stopId`);

--
-- Indexes for table `favouritevehicles`
--
ALTER TABLE `favouritevehicles`
  ADD PRIMARY KEY (`userId`,`vehicleId`,`vehicleType`);

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
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `usertokens`
--
ALTER TABLE `usertokens`
  ADD PRIMARY KEY (`userId`,`token`);

--
-- Indexes for table `vehicles`
--
ALTER TABLE `vehicles`
  ADD PRIMARY KEY (`id`,`type`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `contributorapplications`
--
ALTER TABLE `contributorapplications`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `lastseen`
--
ALTER TABLE `lastseen`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `favouritestops`
--
ALTER TABLE `favouritestops`
  ADD CONSTRAINT `favStops_userId` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
